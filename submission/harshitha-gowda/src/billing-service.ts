import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PlanCatalog } from './plans.ts';
import { ProviderTimeoutError, type ChargeResult, type PaymentProvider } from './payment-provider.ts';
import { SubscriptionStateMachine, type SubscriptionStatus, type Trigger } from './state-machine.ts';

export const MAX_FAILED_ATTEMPTS = 3;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export type WebhookOutcome = 'applied' | 'ignored' | 'duplicate';
type PaymentOutcome = 'succeeded' | 'failed';

interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan: string;
  status: SubscriptionStatus;
  payment_method_id: string;
  amount: number;
  currency: string;
  trial_ends_at: string | null;
  failed_attempts: number;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  subscription_id: string;
  status: 'paid' | 'failed' | 'refunded';
}

interface WebhookEvent {
  event_id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export interface BillingServiceDeps {
  db: DatabaseSync;
  provider: PaymentProvider;
  plans?: PlanCatalog;
  clock?: () => Date;
}

export class BillingService {
  private db: DatabaseSync;
  private provider: PaymentProvider;
  private plans: PlanCatalog;
  private clock: () => Date;

  constructor(deps: BillingServiceDeps) {
    this.db = deps.db;
    this.provider = deps.provider;
    this.plans = deps.plans ?? PlanCatalog.default();
    this.clock = deps.clock ?? (() => new Date());
  }

  // ---------------------------------------------------------------- public API

  async createSubscription(body: unknown) {
    const input = (body ?? {}) as Record<string, unknown>;
    for (const field of ['customer_id', 'plan', 'payment_method_id']) {
      if (typeof input[field] !== 'string' || (input[field] as string).trim() === '') {
        throw new ApiError(400, 'validation_error', `${field} is required`);
      }
    }
    const { customer_id, plan: planName, payment_method_id } = input as Record<string, string>;
    if (!payment_method_id.startsWith('pm_')) {
      throw new ApiError(400, 'validation_error', 'payment_method_id is invalid');
    }
    const plan = this.plans.get(planName);
    if (!plan) throw new ApiError(422, 'unknown_plan');
    if (!this.db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customer_id)) {
      throw new ApiError(404, 'unknown_customer');
    }

    const subId = this.newId('sub');
    const now = this.iso();

    if (plan.startsInTrial) {
      const trialEnds = new Date(this.clock().getTime() + plan.trialDays * 86_400_000).toISOString();
      this.tx(() => {
        this.insertSubscription(subId, customer_id, planName, 'trialing', payment_method_id, plan.amount, plan.currency, trialEnds, now);
        this.audit(subId, null, 'trialing', 'created', 'api_create');
      });
      return this.getSubscription(subId);
    }

    // Charged immediately: the provider is called BEFORE anything is persisted.
    const invoiceId = this.newId('inv');
    const result = await this.charge(customer_id, payment_method_id, plan.amount, plan.currency, invoiceId);
    if (result.outcome === 'declined') throw new ApiError(402, 'payment_declined', result.reason);

    this.tx(() => {
      this.insertSubscription(subId, customer_id, planName, 'active', payment_method_id, plan.amount, plan.currency, null, now);
      this.db
        .prepare('INSERT INTO invoices (id, subscription_id, amount, currency, status, provider_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(invoiceId, subId, plan.amount, plan.currency, 'paid', result.providerRef, now, now);
      this.audit(subId, null, 'active', 'created', 'api_create');
    });
    return this.getSubscription(subId);
  }

  getSubscription(id: string) {
    const sub = this.requireSub(id);
    return {
      id: sub.id,
      customer_id: sub.customer_id,
      plan: sub.plan,
      status: sub.status,
      amount: sub.amount,
      currency: sub.currency,
      trial_ends_at: sub.trial_ends_at,
    };
  }

  cancel(id: string) {
    const sub = this.requireSub(id);
    if (!SubscriptionStateMachine.can(sub.status, 'cancel_requested')) {
      throw new ApiError(409, 'invalid_state', `cannot cancel a ${sub.status} subscription`);
    }
    this.tx(() => this.transition(sub, 'cancel_requested', 'api_cancel'));
    return this.getSubscription(id);
  }

  // Fixture-only seams that stand in for the billing scheduler (trial end / dunning retry).

  async advanceTrial(id: string) {
    const sub = this.requireSub(id);
    if (sub.status !== 'trialing') throw new ApiError(409, 'invalid_state', 'subscription is not trialing');
    await this.chargeAndApply(sub, 'trial_end');
    return this.getSubscription(id);
  }

  async retryCharge(id: string) {
    const sub = this.requireSub(id);
    if (sub.status !== 'past_due') throw new ApiError(409, 'invalid_state', 'subscription is not past_due');
    await this.chargeAndApply(sub, 'retry');
    return this.getSubscription(id);
  }

  handleWebhook(payload: unknown): { status: WebhookOutcome } {
    const e = this.parseWebhook(payload);
    if (!this.findSub(e.subscription_id)) throw new ApiError(404, 'unknown_subscription');

    return this.tx(() => {
      const alreadyProcessed = this.db
        .prepare("SELECT 1 FROM webhook_events WHERE event_id = ? AND outcome != 'duplicate' LIMIT 1")
        .get(e.event_id);
      const outcome: WebhookOutcome = alreadyProcessed ? 'duplicate' : this.applyWebhook(e);
      this.db
        .prepare('INSERT INTO webhook_events (event_id, type, subscription_id, outcome, received_at) VALUES (?,?,?,?,?)')
        .run(e.event_id, e.type, e.subscription_id, outcome, this.iso());
      return { status: outcome };
    });
  }

  // ------------------------------------------------------------------ internals

  private async chargeAndApply(sub: SubscriptionRow, source: 'trial_end' | 'retry') {
    const invoiceId = this.newId('inv');
    const result = await this.charge(sub.customer_id, sub.payment_method_id, sub.amount, sub.currency, invoiceId);
    this.tx(() =>
      this.applyPaymentOutcome(
        sub.id,
        result.outcome === 'succeeded' ? 'succeeded' : 'failed',
        { id: invoiceId, amount: sub.amount, currency: sub.currency, providerRef: result.outcome === 'succeeded' ? result.providerRef : null },
        source,
      ),
    );
  }

  private async charge(customerId: string, paymentMethodId: string, amount: number, currency: string, idempotencyKey: string): Promise<ChargeResult> {
    try {
      return await this.provider.charge({ customerId, paymentMethodId, amount, currency, idempotencyKey });
    } catch (err) {
      if (err instanceof ProviderTimeoutError) throw new ApiError(504, 'provider_timeout');
      throw err;
    }
  }

  private applyWebhook(e: WebhookEvent): WebhookOutcome {
    if (e.type === 'payment.refunded') {
      const inv = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(e.invoice_id) as InvoiceRow | undefined;
      if (!inv || inv.subscription_id !== e.subscription_id || inv.status !== 'paid') return 'ignored';
      this.db.prepare("UPDATE invoices SET status = 'refunded', updated_at = ? WHERE id = ?").run(this.iso(), inv.id);
      return 'applied';
    }
    return this.applyPaymentOutcome(
      e.subscription_id,
      e.type === 'payment.succeeded' ? 'succeeded' : 'failed',
      { id: e.invoice_id, amount: e.amount, currency: e.currency, providerRef: e.event_id },
      'webhook',
    );
  }

  /** Shared by the synchronous charge path and the webhook path. Must run inside a transaction. */
  private applyPaymentOutcome(
    subId: string,
    outcome: PaymentOutcome,
    inv: { id: string; amount: number; currency: string; providerRef: string | null },
    source: string,
  ): 'applied' | 'ignored' {
    const sub = this.requireSub(subId);
    if (sub.status === 'canceled') return 'ignored'; // terminal: never touched again

    const existing = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id) as InvoiceRow | undefined;
    if (existing && existing.subscription_id !== subId) return 'ignored';
    const now = this.iso();

    if (outcome === 'succeeded') {
      if (existing && (existing.status === 'paid' || existing.status === 'refunded')) return 'ignored';
      if (existing) {
        this.db.prepare("UPDATE invoices SET status = 'paid', provider_ref = ?, updated_at = ? WHERE id = ?").run(inv.providerRef, now, inv.id);
      } else {
        this.insertInvoice(inv, subId, 'paid', now);
      }
      const trigger: Trigger | null =
        sub.status === 'trialing' ? 'trial_charge_succeeded' : sub.status === 'past_due' ? 'retry_succeeded' : null;
      if (trigger) this.transition(sub, trigger, source, 0);
      return 'applied';
    }

    // failed: a late/duplicate failure for an invoice we already know about must never regress state
    if (existing) return 'ignored';
    this.insertInvoice(inv, subId, 'failed', now);

    if (sub.status === 'trialing') this.transition(sub, 'trial_charge_failed', source, 1);
    else if (sub.status === 'active') this.transition(sub, 'recurring_charge_failed', source, 1);
    else if (sub.status === 'past_due') {
      const attempts = sub.failed_attempts + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) this.transition(sub, 'retries_exhausted', source, attempts);
      else this.db.prepare('UPDATE subscriptions SET failed_attempts = ?, updated_at = ? WHERE id = ?').run(attempts, now, sub.id);
    }
    return 'applied';
  }

  private transition(sub: SubscriptionRow, trigger: Trigger, source: string, failedAttempts?: number) {
    const to = SubscriptionStateMachine.next(sub.status, trigger); // throws on illegal
    this.db
      .prepare('UPDATE subscriptions SET status = ?, failed_attempts = ?, updated_at = ? WHERE id = ?')
      .run(to, failedAttempts ?? sub.failed_attempts, this.iso(), sub.id);
    this.audit(sub.id, sub.status, to, trigger, source);
  }

  private parseWebhook(p: unknown): WebhookEvent {
    const o = (p ?? {}) as Record<string, unknown>;
    const okTypes = ['payment.succeeded', 'payment.failed', 'payment.refunded'];
    const strings = ['event_id', 'subscription_id', 'invoice_id', 'currency'];
    if (
      strings.some((k) => typeof o[k] !== 'string' || o[k] === '') ||
      typeof o.amount !== 'number' ||
      typeof o.type !== 'string' ||
      !okTypes.includes(o.type)
    ) {
      throw new ApiError(400, 'malformed_event');
    }
    return o as unknown as WebhookEvent;
  }

  private insertSubscription(id: string, customerId: string, plan: string, status: SubscriptionStatus, pm: string, amount: number, currency: string, trialEnds: string | null, now: string) {
    this.db
      .prepare('INSERT INTO subscriptions (id, customer_id, plan, status, payment_method_id, amount, currency, trial_ends_at, failed_attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)')
      .run(id, customerId, plan, status, pm, amount, currency, trialEnds, now, now);
  }

  private insertInvoice(inv: { id: string; amount: number; currency: string; providerRef: string | null }, subId: string, status: string, now: string) {
    this.db
      .prepare('INSERT INTO invoices (id, subscription_id, amount, currency, status, provider_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(inv.id, subId, inv.amount, inv.currency, status, inv.providerRef, now, now);
  }

  private audit(subId: string, from: SubscriptionStatus | null, to: SubscriptionStatus, trigger: string, source: string) {
    this.db
      .prepare('INSERT INTO subscription_events (subscription_id, from_status, to_status, trigger, source, at) VALUES (?,?,?,?,?,?)')
      .run(subId, from, to, trigger, source, this.iso());
  }

  private findSub(id: string): SubscriptionRow | undefined {
    return this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as SubscriptionRow | undefined;
  }

  private requireSub(id: string): SubscriptionRow {
    const sub = this.findSub(id);
    if (!sub) throw new ApiError(404, 'unknown_subscription');
    return sub;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private iso(): string {
    return this.clock().toISOString();
  }

  private newId(prefix: string): string {
    return `${prefix}_${randomBytes(4).toString('hex')}`;
  }
}
