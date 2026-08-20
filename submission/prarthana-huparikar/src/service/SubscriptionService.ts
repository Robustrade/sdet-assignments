import { randomUUID } from 'crypto';
import { Subscription, InboundWebhookPayload } from '../domain/types';
import { SubscriptionStateMachine, Trigger } from '../domain/SubscriptionState';
import { PaymentProvider } from '../domain/PaymentProvider';
import { SubscriptionRepository, InvoiceRepository, WebhookEventRepository } from './Repository';

const PLANS: Record<string, { priceCents: number; trialDays: number }> = {
  basic: { priceCents: 1900, trialDays: 7 },
  pro: { priceCents: 4900, trialDays: 14 },
};

export class UnknownPlanError extends Error {}
export class SubscriptionNotFoundError extends Error {}
export class ValidationError extends Error {}

export interface CreateSubscriptionInput {
  customerId: string;
  plan: string;
  paymentMethodId: string;
}

export interface WebhookHandlingResult {
  applied: boolean;
  reason?: 'duplicate_event' | 'unsupported_event_type' | 'invalid_transition' | 'stale_out_of_order_event';
}

export class SubscriptionService {
  constructor(
    private subs: SubscriptionRepository,
    private invoices: InvoiceRepository,
    private webhookEvents: WebhookEventRepository,
    private provider: PaymentProvider,
  ) {}

  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    if (!input || !input.customerId || !input.paymentMethodId) {
      throw new ValidationError('customerId and paymentMethodId are required');
    }
    const plan = PLANS[input.plan];
    if (!plan) {
      throw new UnknownPlanError(`Unknown plan: ${input.plan}`);
    }

    const now = new Date().toISOString();
    const sub: Subscription = {
      id: `sub_${randomUUID()}`,
      customerId: input.customerId,
      planId: input.plan,
      status: 'trialing',
      paymentMethodId: input.paymentMethodId,
      createdAt: now,
      updatedAt: now,
    };
    this.subs.save(sub);
    // No charge on creation itself - billing happens when the trial ends,
    // via triggerTrialEnd(), kept as an explicit, independently testable step.
    return sub;
  }

  getSubscription(id: string): Subscription {
    const sub = this.subs.findById(id);
    if (!sub) throw new SubscriptionNotFoundError(id);
    return sub;
  }

  async cancelSubscription(id: string): Promise<Subscription> {
    const sub = this.getSubscription(id);
    const nextStatus = SubscriptionStateMachine.nextState(sub.status, 'cancel'); // throws if already canceled
    const updated: Subscription = { ...sub, status: nextStatus, updatedAt: new Date().toISOString() };
    this.subs.save(updated);
    return updated;
  }

  /** Simulates the trial ending and the resulting first-charge attempt via the payment provider. */
  async triggerTrialEnd(id: string): Promise<Subscription> {
    const sub = this.getSubscription(id);
    const plan = PLANS[sub.planId];

    const result = await this.provider.charge({
      customerId: sub.customerId,
      paymentMethodId: sub.paymentMethodId,
      amountCents: plan.priceCents,
      currency: 'USD',
      reference: `${sub.id}-trial-end`,
    });

    const trigger: Trigger = result.outcome === 'success' ? 'trial_charge_succeeded' : 'trial_charge_failed';
    const nextStatus = SubscriptionStateMachine.nextState(sub.status, trigger);
    const updated: Subscription = { ...sub, status: nextStatus, updatedAt: new Date().toISOString() };
    this.subs.save(updated);

    this.invoices.save({
      id: `inv_${randomUUID()}`,
      subscriptionId: sub.id,
      invoiceRef: `${sub.id}-trial-end`,
      amountCents: plan.priceCents,
      currency: 'USD',
      status: result.outcome === 'success' ? 'succeeded' : 'failed',
      createdAt: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Processes an inbound webhook. Idempotent by event_id, and defends
   * against out-of-order delivery for the same invoice_id (a late
   * payment.failed must not regress a subscription an earlier
   * payment.succeeded already made active).
   */
  async handleWebhook(payload: InboundWebhookPayload): Promise<WebhookHandlingResult> {
    if (this.webhookEvents.hasProcessed(payload.event_id)) {
      return { applied: false, reason: 'duplicate_event' };
    }

    const sub = this.subs.findById(payload.subscription_id);
    if (!sub) throw new SubscriptionNotFoundError(payload.subscription_id);

    // Record the event as processed regardless of outcome - this IS the
    // idempotency ledger and audit trail, not just a side effect of success.
    this.webhookEvents.record({
      eventId: payload.event_id,
      type: payload.type,
      subscriptionId: payload.subscription_id,
      processedAt: new Date().toISOString(),
    });

    // The trigger a webhook maps to depends on where the subscription
    // currently is: a first-ever charge (still trialing) uses the
    // trial_charge_* triggers, while a recurring charge (already active or
    // past_due) uses charge_*. Same event type, different trigger.
    const trigger = this.webhookTypeToTrigger(payload.type, sub.status);
    if (!trigger) {
      return { applied: false, reason: 'unsupported_event_type' };
    }

    // Out-of-order guard: if this invoice already has a succeeded record,
    // a later payment.failed for the same invoice_id is stale and must not
    // regress the subscription.
    if (payload.type === 'payment.failed') {
      const alreadySucceeded = this.invoices
        .findByInvoiceRef(sub.id, payload.invoice_id)
        .some((inv) => inv.status === 'succeeded');
      if (alreadySucceeded) {
        return { applied: false, reason: 'stale_out_of_order_event' };
      }
    }

    if (!SubscriptionStateMachine.canTransition(sub.status, trigger)) {
      // e.g. payment.succeeded for an already-canceled subscription -
      // structurally rejected by the transition table, not special-cased here.
      return { applied: false, reason: 'invalid_transition' };
    }

    const nextStatus = SubscriptionStateMachine.nextState(sub.status, trigger);
    const updated: Subscription = { ...sub, status: nextStatus, updatedAt: new Date().toISOString() };
    this.subs.save(updated);

    this.invoices.save({
      id: `inv_${randomUUID()}`,
      subscriptionId: sub.id,
      invoiceRef: payload.invoice_id,
      amountCents: payload.amount,
      currency: payload.currency,
      status: payload.type === 'payment.succeeded' ? 'succeeded' : 'failed',
      createdAt: new Date().toISOString(),
    });

    return { applied: true };
  }

  private webhookTypeToTrigger(
    type: InboundWebhookPayload['type'],
    currentStatus: Subscription['status'],
  ): Trigger | undefined {
    if (type === 'payment.succeeded') {
      return currentStatus === 'trialing' ? 'trial_charge_succeeded' : 'charge_succeeded';
    }
    if (type === 'payment.failed') {
      return currentStatus === 'trialing' ? 'trial_charge_failed' : 'charge_failed';
    }
    return undefined; // payment.refunded and any other type: not modeled as a transition
  }
}
