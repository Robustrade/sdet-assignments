import { createHash } from 'crypto';
import { z } from 'zod';
import { SubscriptionLifecycle } from '../domain/lifecycle';
import { PlanCatalog } from '../domain/plans';
import { Clock } from '../domain/time';
import { CURRENCY, Subscription } from '../domain/types';
import { Repositories } from '../persistence/repositories';
import { SqlDatabase } from '../persistence/SqlDatabase';
import { BillingEngine } from './BillingEngine';
import { DomainError } from './errors';
import { IdGenerator } from './ids';

export const createSubscriptionSchema = z.object({
  customer_id: z.string().min(1),
  plan: z.string().min(1),
  payment_method_id: z.string().min(1),
});
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export interface SubscriptionView {
  id: string;
  customer_id: string;
  plan: string;
  status: string;
  payment_method_id: string;
  amount: number;
  currency: string;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string;
  canceled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  latest_invoice: { id: string; status: string; amount: number; failed_attempts: number } | null;
}

export interface HttpResult<T> {
  status: number;
  body: T;
  replayed?: boolean;
}

export class SubscriptionService {
  constructor(
    private readonly db: SqlDatabase,
    private readonly repos: Repositories,
    private readonly plans: PlanCatalog,
    private readonly billing: BillingEngine,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Create with an optional client idempotency key: a retried request with the same key and body gets
   * the original response back instead of a second subscription (and a second charge).
   */
  async create(rawInput: unknown, idempotencyKey?: string): Promise<HttpResult<SubscriptionView>> {
    const input = this.parse(rawInput);
    if (!idempotencyKey) return { status: 201, body: await this.createSubscription(input) };

    const requestHash = createHash('sha256').update(JSON.stringify([input.customer_id, input.plan, input.payment_method_id])).digest('hex');
    const previous = this.repos.idempotencyKeys.find(idempotencyKey);
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new DomainError('idempotency_key_reused', 'Idempotency-Key was already used with a different request');
      }
      if (previous.status === 0) throw new DomainError('request_in_progress', 'A request with this Idempotency-Key is still in progress');
      return { status: previous.status, body: previous.body as SubscriptionView, replayed: true };
    }

    // Reserve the key before doing any work, so a concurrent retry can't slip past the check above.
    this.repos.idempotencyKeys.save(idempotencyKey, requestHash, 0, null, this.clock.now());
    try {
      const body = await this.createSubscription(input);
      this.db.run('UPDATE idempotency_keys SET response_status = 201, response_body = ? WHERE key = ?', [JSON.stringify(body), idempotencyKey]);
      return { status: 201, body };
    } catch (error) {
      this.db.run('DELETE FROM idempotency_keys WHERE key = ?', [idempotencyKey]);
      throw error;
    }
  }

  get(id: string): SubscriptionView {
    const sub = this.repos.subscriptions.findById(id);
    if (!sub) throw new DomainError('not_found', `Subscription ${id} not found`);
    return this.view(sub);
  }

  cancel(id: string): SubscriptionView {
    const now = this.clock.now();
    this.db.transaction(() => {
      const sub = this.repos.subscriptions.findById(id);
      if (!sub) throw new DomainError('not_found', `Subscription ${id} not found`);

      const decision = SubscriptionLifecycle.decide(sub.id, sub.status, 'cancel_requested');
      if (decision.kind !== 'transition') {
        throw new DomainError('invalid_transition', `Cannot cancel a subscription that is ${sub.status}`, {
          current_status: sub.status,
        });
      }
      this.repos.subscriptions.applyTransition(decision.transition, now, 'customer_request');
      this.repos.audit.append({
        subscriptionId: sub.id,
        action: 'status_changed',
        fromStatus: decision.transition.from,
        toStatus: decision.transition.to,
        source: 'api',
        reference: 'customer_request',
        at: now,
      });
      // Stop future billing: nothing open should be collected after cancellation.
      const open = this.repos.invoices.findOpenForSubscription(sub.id);
      if (open) this.repos.invoices.transition(open.id, 'voided', now);
      this.repos.notifications.record(sub.id, 'subscription_canceled', sub.id, now);
    });
    return this.get(id);
  }

  private parse(rawInput: unknown): CreateSubscriptionInput {
    const parsed = createSubscriptionSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new DomainError('invalid_request', 'Request body failed validation', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return parsed.data;
  }

  private async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionView> {
    const plan = this.plans.find(input.plan);
    if (!plan) throw new DomainError('unknown_plan', `Plan '${input.plan}' does not exist`, { allowed: this.plans.codes() });
    if (!this.repos.customers.findById(input.customer_id)) {
      throw new DomainError('unknown_customer', `Customer '${input.customer_id}' does not exist`);
    }
    const pm = this.repos.customers.findPaymentMethod(input.payment_method_id);
    if (!pm || pm.customerId !== input.customer_id || pm.status !== 'active') {
      throw new DomainError('invalid_payment_method', 'Payment method is unknown, expired, or belongs to another customer');
    }

    const now = this.clock.now();
    const id = this.ids.next('sub');
    const trialEndsAt = plan.trialEndsAt(now);

    const attempt = this.db.transaction(() => {
      this.repos.subscriptions.insert({
        id,
        customerId: input.customer_id,
        plan: plan.code,
        paymentMethodId: pm.id,
        priceCents: plan.priceCents,
        currency: CURRENCY,
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        createdAt: now,
        updatedAt: now,
      });
      this.repos.audit.append({ subscriptionId: id, action: 'created', toStatus: 'trialing', source: 'api', at: now });
      if (plan.trialDays > 0) return null;

      // No trial: the trial is already over, so the first charge happens now.
      const sub = this.repos.subscriptions.findById(id) as Subscription;
      const invoice = this.billing.openInvoice(sub, now, 'api');
      return this.billing.reserveAttempt(invoice);
    });

    if (attempt) await this.billing.send(attempt, 'api');
    return this.get(id);
  }

  private view(sub: Subscription): SubscriptionView {
    const invoices = this.repos.invoices.findBySubscription(sub.id);
    const latest = invoices[invoices.length - 1];
    return {
      id: sub.id,
      customer_id: sub.customerId,
      plan: sub.plan,
      status: sub.status,
      payment_method_id: sub.paymentMethodId,
      amount: sub.priceCents,
      currency: sub.currency,
      trial_ends_at: sub.trialEndsAt,
      current_period_start: sub.currentPeriodStart,
      current_period_end: sub.currentPeriodEnd,
      canceled_at: sub.canceledAt,
      cancel_reason: sub.cancelReason,
      created_at: sub.createdAt,
      latest_invoice: latest
        ? { id: latest.id, status: latest.status, amount: latest.amountCents, failed_attempts: latest.failedAttempts }
        : null,
    };
  }
}
