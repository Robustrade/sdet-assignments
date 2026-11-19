import { createHash } from 'node:crypto';
import { addDays, Clock } from '../clock';
import { TransactionRunner } from '../db/database';
import { AppError } from '../domain/errors';
import { Subscription } from '../domain/types';
import { IdGenerator } from '../ids';
import { Repositories } from '../repositories';
import { BillingService } from './billing-service';
import { Lifecycle } from './lifecycle';

export interface CreateSubscriptionInput {
  customerId: string;
  planId: string;
  paymentMethodId: string;
}

export interface CreateResult {
  subscription: Subscription;
  /** True when an Idempotency-Key replay returned an existing subscription. */
  replayed: boolean;
}

/** Fixture rule for a syntactically valid test payment method (API_CONTRACTS §3). */
const PAYMENT_METHOD_PATTERN = /^pm_[A-Za-z0-9_]+$/;

export class SubscriptionService {
  constructor(
    private readonly repos: Repositories,
    private readonly tx: TransactionRunner,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly lifecycle: Lifecycle,
    private readonly billing: BillingService,
  ) {}

  async create(input: CreateSubscriptionInput, idempotencyKey?: string): Promise<CreateResult> {
    const requestHash = hashRequest(input);

    // Duplicate request? (API_CONTRACTS §3.1) - checked before anything is written.
    if (idempotencyKey !== undefined) {
      const existing = this.repos.idempotencyKeys.findByKey(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
        }
        return { subscription: this.repos.subscriptions.findById(existing.subscriptionId)!, replayed: true };
      }
    }

    if (!this.repos.customers.findById(input.customerId)) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', `Customer ${input.customerId} does not exist`);
    }
    const plan = this.repos.plans.findById(input.planId);
    if (!plan) throw new AppError(422, 'INVALID_PLAN', `Plan ${input.planId} is not supported`);
    if (!PAYMENT_METHOD_PATTERN.test(input.paymentMethodId)) {
      throw new AppError(422, 'INVALID_PAYMENT_METHOD', 'payment_method_id is not a valid payment method');
    }

    // Tx A: subscription + audit + idempotency key (+ first invoice and pending attempt
    // for immediate-billing plans) commit together. No await happens before this point
    // after the key lookup, so two requests cannot interleave in this single-threaded fixture.
    const now = this.clock.now().toISOString();
    const { subscription, firstPaymentId } = this.tx(() => {
      const created: Subscription = {
        id: this.ids.next('sub'),
        customerId: input.customerId,
        planId: plan.id,
        paymentMethodId: input.paymentMethodId,
        status: 'trialing', // immediate plans use a zero-length trial (assumption A-01)
        trialEnd: addDays(now, plan.trialDays),
        currentPeriodEnd: null,
        createdAt: now,
        updatedAt: now,
        canceledAt: null,
      };
      this.repos.subscriptions.insert(created);
      this.lifecycle.recordCreation(created);
      if (idempotencyKey !== undefined) {
        this.repos.idempotencyKeys.insert({ key: idempotencyKey, requestHash, subscriptionId: created.id, createdAt: now });
      }
      let paymentId: string | null = null;
      if (plan.trialDays === 0) {
        const invoice = this.billing.createInvoice(created, plan, now);
        paymentId = this.billing.createAttempt(invoice, 1).id;
      }
      return { subscription: created, firstPaymentId: paymentId };
    });

    if (firstPaymentId) await this.billing.executeCharge(firstPaymentId); // provider call + Tx B

    return { subscription: this.repos.subscriptions.findById(subscription.id)!, replayed: false };
  }

  get(id: string): Subscription {
    const subscription = this.repos.subscriptions.findById(id);
    if (!subscription) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', `Subscription ${id} does not exist`);
    return subscription;
  }

  /** Cancel is allowed only where the transition table allows it (trialing, active). */
  cancel(id: string): Subscription {
    return this.tx(() => {
      const subscription = this.get(id);
      if (!this.lifecycle.canApply(subscription, 'cancel_requested')) {
        throw new AppError(409, 'INVALID_TRANSITION', `A ${subscription.status} subscription cannot be canceled`);
      }
      const now = this.clock.now().toISOString();
      for (const invoice of this.repos.invoices.findBySubscription(id)) {
        if (invoice.status === 'open') this.repos.invoices.updateStatus(invoice.id, 'void', now); // stop future billing
      }
      return this.lifecycle.apply(subscription, 'cancel_requested', { trigger: 'api_cancel', referenceId: null }, {
        canceledAt: now,
      });
    });
  }
}

function hashRequest(input: CreateSubscriptionInput): string {
  const normalised = JSON.stringify([input.customerId, input.planId, input.paymentMethodId]);
  return createHash('sha256').update(normalised).digest('hex');
}
