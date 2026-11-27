/**
 * Subscription lifecycle application service.
 * Author: Vedant Dalkari
 */

import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { LifecycleEngine } from '../domain/LifecycleEngine.js';
import type { PlanPolicyRegistry } from '../domain/PlanPolicy.js';
import type { SubscriptionSnapshot } from '../domain/types.js';
import type { AuditLogRepo } from '../persistence/AuditLogRepo.js';
import type { CustomerRepo } from '../persistence/CustomerRepo.js';
import type { InvoiceRepo } from '../persistence/InvoiceRepo.js';
import type { PaymentAttemptRepo } from '../persistence/PaymentAttemptRepo.js';
import type { SqliteDatabase } from '../persistence/SqliteDatabase.js';
import type { SubscriptionRepo } from '../persistence/SubscriptionRepo.js';
import type { BillingGateway } from '../ports/BillingGateway.js';
import type { Clock } from '../ports/Clock.js';
import type { NotificationMessage, Notifier } from '../ports/Notifier.js';
import {
  invokeGatewaySafely,
  nextPrefixedId,
  requireNonEmptyString,
  toAttemptStatus,
  toSubscriptionSnapshot,
} from './chargeHelpers.js';

export interface SubscriptionServiceDeps {
  readonly db: SqliteDatabase;
  readonly customerRepo: CustomerRepo;
  readonly subscriptionRepo: SubscriptionRepo;
  readonly invoiceRepo: InvoiceRepo;
  readonly paymentAttemptRepo: PaymentAttemptRepo;
  readonly auditLogRepo: AuditLogRepo;
  readonly lifecycleEngine: LifecycleEngine;
  readonly planRegistry: PlanPolicyRegistry;
  readonly billingGateway: BillingGateway;
  readonly clock: Clock;
  readonly notifier: Notifier;
}

export interface CreateSubscriptionInput {
  readonly customer_id: string;
  readonly plan: string;
  readonly payment_method_id: string;
}

export class SubscriptionService {
  public constructor(private readonly deps: SubscriptionServiceDeps) {}

  public async createSubscription(input: unknown): Promise<SubscriptionSnapshot> {
    const validated = this.parseCreateInput(input);
    const policy = this.deps.planRegistry.resolve(validated.plan);

    const customer = this.deps.customerRepo.findById(validated.customer_id);
    if (!customer) {
      throw new NotFoundError(`Customer "${validated.customer_id}" not found`);
    }

    const nowIso = this.deps.clock.nowIso();
    const period = policy.computeInitialPeriod(nowIso);
    const subId = nextPrefixedId('sub');

    if (policy.config.trialDays > 0) {
      const created = this.deps.db.inTransaction(() => {
        const transition = this.deps.lifecycleEngine.transition(null, 'signup_trial');
        const row = this.deps.subscriptionRepo.createWithInitialTransition(
          {
            id: subId,
            customer_id: customer.id,
            plan: policy.config.plan,
            payment_method_id: validated.payment_method_id,
            failed_attempts: 0,
            trial_ends_at: period.trialEndsAt,
            current_period_start: period.periodStart,
            current_period_end: period.periodEnd,
            canceled_at: null,
            created_at: nowIso,
            updated_at: nowIso,
          },
          transition,
        );
        this.deps.auditLogRepo.append({
          id: nextPrefixedId('aud'),
          subscription_id: subId,
          from_status: null,
          to_status: transition.toStatus,
          trigger: transition.trigger,
          actor: 'api',
          metadata_json: JSON.stringify({ plan: policy.config.plan }),
          created_at: nowIso,
        });
        return row;
      });

      await this.deps.notifier.notify({
        eventType: 'subscription.created',
        subscriptionId: created.id,
        customerId: created.customer_id,
        occurredAt: nowIso,
      });

      return toSubscriptionSnapshot(created);
    }

    const invoiceId = nextPrefixedId('inv');
    const idempotencyKey = `gw_${subId}_${invoiceId}_init`;
    const chargeResult = await invokeGatewaySafely(this.deps.billingGateway, {
      customerId: customer.id,
      amountCents: policy.config.amountCents,
      currency: policy.config.currency,
      paymentMethodId: validated.payment_method_id,
      idempotencyKey,
    });

    const isApproved = chargeResult.status === 'approved';
    const trigger = isApproved ? 'signup_charge_succeeded' : 'signup_charge_failed';

    const created = this.deps.db.inTransaction(() => {
      const transition = this.deps.lifecycleEngine.transition(null, trigger);
      const row = this.deps.subscriptionRepo.createWithInitialTransition(
        {
          id: subId,
          customer_id: customer.id,
          plan: policy.config.plan,
          payment_method_id: validated.payment_method_id,
          failed_attempts: isApproved ? 0 : 1,
          trial_ends_at: null,
          current_period_start: period.periodStart,
          current_period_end: period.periodEnd,
          canceled_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        },
        transition,
      );

      this.deps.invoiceRepo.create({
        id: invoiceId,
        subscription_id: subId,
        amount_cents: policy.config.amountCents,
        currency: policy.config.currency,
        status: isApproved ? 'paid' : 'failed',
        period_start: period.periodStart,
        period_end: period.periodEnd,
        created_at: nowIso,
        updated_at: nowIso,
      });

      this.deps.paymentAttemptRepo.create({
        id: nextPrefixedId('att'),
        invoice_id: invoiceId,
        subscription_id: subId,
        idempotency_key: idempotencyKey,
        amount_cents: policy.config.amountCents,
        currency: policy.config.currency,
        status: toAttemptStatus(chargeResult),
        provider_reference: chargeResult.status === 'approved' ? chargeResult.providerReference : null,
        failure_reason: chargeResult.status === 'approved' ? null : chargeResult.reason,
        created_at: nowIso,
      });

      this.deps.auditLogRepo.append({
        id: nextPrefixedId('aud'),
        subscription_id: subId,
        from_status: null,
        to_status: transition.toStatus,
        trigger: transition.trigger,
        actor: 'api',
        metadata_json: JSON.stringify({ invoice_id: invoiceId }),
        created_at: nowIso,
      });

      return row;
    });

    const eventType: NotificationMessage['eventType'] = isApproved
      ? 'subscription.activated'
      : 'subscription.past_due';
    await this.deps.notifier.notify({
      eventType,
      subscriptionId: created.id,
      customerId: created.customer_id,
      occurredAt: nowIso,
    });

    return toSubscriptionSnapshot(created);
  }

  public async getSubscription(id: string): Promise<SubscriptionSnapshot> {
    await Promise.resolve();
    const sub = this.deps.subscriptionRepo.findById(id);
    if (!sub) {
      throw new NotFoundError(`Subscription "${id}" not found`);
    }
    return toSubscriptionSnapshot(sub);
  }

  public async cancelSubscription(id: string): Promise<SubscriptionSnapshot> {
    const nowIso = this.deps.clock.nowIso();

    const updated = this.deps.db.inTransaction(() => {
      const existing = this.deps.subscriptionRepo.findById(id);
      if (!existing) {
        throw new NotFoundError(`Subscription "${id}" not found`);
      }
      if (existing.status !== 'trialing' && existing.status !== 'active') {
        throw new ConflictError(
          `Cannot cancel subscription in "${existing.status}" status`,
        );
      }

      const transition = this.deps.lifecycleEngine.transition(existing.status, 'api_cancel');
      const next = this.deps.subscriptionRepo.commitTransition(existing.id, transition, {
        canceled_at: nowIso,
        updated_at: nowIso,
      });

      this.deps.auditLogRepo.append({
        id: nextPrefixedId('aud'),
        subscription_id: existing.id,
        from_status: existing.status,
        to_status: transition.toStatus,
        trigger: transition.trigger,
        actor: 'api',
        metadata_json: '{}',
        created_at: nowIso,
      });

      return next;
    });

    await this.deps.notifier.notify({
      eventType: 'subscription.canceled',
      subscriptionId: updated.id,
      customerId: updated.customer_id,
      occurredAt: nowIso,
    });

    return toSubscriptionSnapshot(updated);
  }

  private parseCreateInput(input: unknown): CreateSubscriptionInput {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new ValidationError('Request body must be a JSON object');
    }
    const obj = input as Record<string, unknown>;
    const customerId = requireNonEmptyString(obj.customer_id, 'customer_id');
    const plan = requireNonEmptyString(obj.plan, 'plan');
    const paymentMethodId = requireNonEmptyString(obj.payment_method_id, 'payment_method_id');
    return {
      customer_id: customerId,
      plan,
      payment_method_id: paymentMethodId,
    };
  }
}
