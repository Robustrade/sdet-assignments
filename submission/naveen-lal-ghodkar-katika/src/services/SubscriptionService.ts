import { BillingError } from '../errors';
import { auditEntryFor } from '../domain/AuditEntry';
import type { InvoiceRecord } from '../domain/Invoice';
import { findPlan, type Plan } from '../domain/plans';
import type { SubscriptionRecord } from '../domain/Subscription';
import { Subscription, type TransitionResult } from '../domain/SubscriptionStateMachine';
import type { AuditLogRepository } from '../persistence/AuditLogRepository';
import type { CustomerRepository } from '../persistence/CustomerRepository';
import type { IdempotencyRepository } from '../persistence/IdempotencyRepository';
import type { InvoiceRepository } from '../persistence/InvoiceRepository';
import type { SubscriptionRepository } from '../persistence/SubscriptionRepository';
import type { Clock } from '../support/Clock';
import type { IdGenerator } from '../support/IdGenerator';
import type { KeyedMutex } from '../support/KeyedMutex';
import { initialChargeKey, type BillingService, type ChargeOutcome } from './BillingService';

export interface CreateSubscriptionInput {
  customerId: string;
  plan: string;
  paymentMethodId: string;
  /** Optional caller-chosen key that makes a retried creation safe (no second charge). */
  idempotencyKey?: string;
}

export interface CreateSubscriptionResult {
  subscription: SubscriptionRecord;
  /** True when the key had already produced this subscription and nothing new was done. */
  replayed: boolean;
}

const PAYMENT_METHOD_PATTERN = /^pm_[A-Za-z0-9_]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export class SubscriptionService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly customers: CustomerRepository,
    private readonly invoices: InvoiceRepository,
    private readonly auditLog: AuditLogRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly billing: BillingService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    /** Shared with webhook processing, so cancel and webhooks never interleave on one subscription. */
    private readonly mutex: KeyedMutex,
  ) {}

  async create(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    // Every check happens before anything is written or charged, so a rejected request
    // persists nothing and never reaches the payment provider.
    if (!(await this.customers.exists(input.customerId))) {
      throw new BillingError('customer_not_found', `Unknown customer "${input.customerId}"`);
    }
    const plan = findPlan(input.plan);
    if (!plan) {
      throw new BillingError('invalid_plan', `Unknown plan "${input.plan}"`);
    }
    if (!PAYMENT_METHOD_PATTERN.test(input.paymentMethodId)) {
      throw new BillingError('invalid_payment_method', 'payment_method_id must look like "pm_..."');
    }

    const resolved = await this.resolveSubscriptionId(input, plan);
    if (resolved.replayed) {
      return { subscription: resolved.existing, replayed: true };
    }

    const createdAt = this.clock.now();
    const initial: SubscriptionRecord = {
      id: resolved.subscriptionId,
      customerId: input.customerId,
      plan: plan.id,
      status: 'trialing',
      priceCents: plan.priceCents,
      currency: plan.currency,
      paymentMethodId: input.paymentMethodId,
      trialEndsAt: new Date(createdAt.getTime() + plan.trialDays * DAY_MS).toISOString(),
      createdAt: createdAt.toISOString(),
    };

    // A plan without a trial is charged right now. Status only changes through the state machine,
    // and only from the provider's answer: a timeout throws here, before anything is saved.
    const subscription = Subscription.rehydrate(initial);
    let invoice: InvoiceRecord | undefined;
    let transition: TransitionResult | undefined;
    if (plan.trialDays === 0) {
      const outcome = await this.billing.chargeInitial(initial, input.paymentMethodId);
      transition = subscription.apply(outcome.trigger);
      invoice = this.initialInvoice(initial, outcome, createdAt);
    }

    // Not one database transaction (in-memory): the subscription is saved first, then its records.
    const stored = subscription.toRecord();
    await this.subscriptions.save(stored);
    if (invoice && transition) {
      await this.invoices.save(invoice);
      await this.auditLog.append(auditEntryFor(stored.id, transition, 'api', createdAt));
    }
    return { subscription: stored, replayed: false };
  }

  async get(id: string): Promise<SubscriptionRecord> {
    return this.require(id);
  }

  async cancel(id: string): Promise<SubscriptionRecord> {
    return this.mutex.runExclusive(id, async () => {
      const subscription = Subscription.rehydrate(await this.require(id));
      const transition = subscription.apply('cancel'); // throws InvalidTransitionError (409) before anything is saved
      const canceled = subscription.toRecord();
      await this.subscriptions.save(canceled);
      await this.auditLog.append(auditEntryFor(id, transition, 'api', this.clock.now()));
      return canceled;
    });
  }

  private initialInvoice(subscription: SubscriptionRecord, outcome: ChargeOutcome, at: Date): InvoiceRecord {
    const now = at.toISOString();
    return {
      id: this.ids.next('inv'),
      subscriptionId: subscription.id,
      amount: subscription.priceCents,
      currency: subscription.currency,
      status: outcome.trigger === 'charge_succeeded' ? 'paid' : 'failed',
      attempt: 1,
      idempotencyKey: initialChargeKey(subscription.id),
      ...(outcome.providerChargeId === undefined ? {} : { providerChargeId: outcome.providerChargeId }),
      ...(outcome.declineCode === undefined ? {} : { declineCode: outcome.declineCode }),
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Decides which subscription id this request is for.
   * - No key: a fresh id (no way to recognize a retry).
   * - Unknown key: a fresh id, reserved for the key before any charge is attempted.
   * - Known key, same request, subscription exists: a replay, answered without charging.
   * - Known key, same request, no subscription yet (earlier attempt timed out): the reserved id is
   *   reused, so the retry carries the same provider idempotency key and reference.
   * - Known key, different request: conflict.
   */
  private async resolveSubscriptionId(
    input: CreateSubscriptionInput,
    plan: Plan,
  ): Promise<{ replayed: true; existing: SubscriptionRecord } | { replayed: false; subscriptionId: string }> {
    const key = input.idempotencyKey;
    if (key === undefined) {
      return { replayed: false, subscriptionId: this.ids.next('sub') };
    }

    const fingerprint = JSON.stringify([input.customerId, plan.id, input.paymentMethodId]);
    const reservation = await this.idempotency.find(key);
    if (!reservation) {
      const subscriptionId = this.ids.next('sub');
      await this.idempotency.save({ key, fingerprint, subscriptionId });
      return { replayed: false, subscriptionId };
    }

    if (reservation.fingerprint !== fingerprint) {
      throw new BillingError('idempotency_conflict', 'Idempotency-Key was already used for a different request');
    }
    const existing = await this.subscriptions.findById(reservation.subscriptionId);
    return existing
      ? { replayed: true, existing }
      : { replayed: false, subscriptionId: reservation.subscriptionId };
  }

  private async require(id: string): Promise<SubscriptionRecord> {
    const subscription = await this.subscriptions.findById(id);
    if (!subscription) {
      throw new BillingError('subscription_not_found', `Subscription "${id}" not found`);
    }
    return subscription;
  }
}
