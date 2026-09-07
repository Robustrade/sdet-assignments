import { randomUUID } from 'crypto';
import { PlanCatalog } from './plans';
import { SubscriptionStateMachine } from './stateMachine';
import { PaymentProviderClient, ChargeRequest, ChargeResult } from './paymentProvider';
import { Store } from '../persistence/inMemoryRepository';
import {
  Subscription, Invoice, AuditLogEntry, SubscriptionState, WebhookEventType, PlanConfig,
} from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface CreateSubscriptionInput {
  customer_id: string;
  plan: string;
  payment_method_id: string;
}

export interface InboundWebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

const MAX_RETRIES = 3;

export class SubscriptionService {
  constructor(
    private readonly store: Store,
    private readonly paymentProvider: PaymentProviderClient,
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  private audit(
    subscriptionId: string,
    action: string,
    from: SubscriptionState | null,
    to: SubscriptionState | null,
    detail: string,
  ): void {
    const entry: AuditLogEntry = {
      id: randomUUID(), subscriptionId, timestamp: this.now(), action, fromState: from, toState: to, detail,
    };
    this.store.auditLog.append(entry);
  }

  private async safeCharge(req: ChargeRequest): Promise<ChargeResult> {
    try {
      return await this.paymentProvider.charge(req);
    } catch {
      return { outcome: 'timeout', providerChargeId: null };
    }
  }

  private recordInvoiceFromCharge(
    subscriptionId: string,
    amountCents: number,
    currency: string,
    charge: ChargeResult,
  ): void {
    const invoice: Invoice = {
      id: `inv_${randomUUID()}`,
      subscriptionId,
      amountCents,
      currency,
      status: charge.outcome === 'succeeded' ? 'paid' : 'failed',
      createdAt: this.now(),
      providerChargeId: charge.providerChargeId,
    };
    this.store.invoices.save(invoice);
  }

  private markLastInvoiceRefunded(subscriptionId: string): void {
    const invoices = this.store.invoices.forSubscription(subscriptionId);
    const last = invoices[invoices.length - 1];
    if (last) this.store.invoices.save({ ...last, status: 'refunded' });
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    if (!input || !input.customer_id) throw new ValidationError('customer_id is required');
    if (!this.store.customers.exists(input.customer_id)) {
      throw new ValidationError(`unknown customer '${input.customer_id}'`);
    }
    if (!input.payment_method_id) throw new ValidationError('payment_method_id is required');
    if (!input.plan || !PlanCatalog.exists(input.plan)) {
      throw new ValidationError(`unknown plan '${input?.plan}'`);
    }

    const planConfig = PlanCatalog.get(input.plan)!;
    const id = `sub_${randomUUID()}`;
    const trialEndsAt = planConfig.trialDays > 0
      ? new Date(Date.now() + planConfig.trialDays * 86400000).toISOString()
      : null;

    const subscription: Subscription = {
      id,
      customerId: input.customer_id,
      plan: planConfig.id,
      paymentMethodId: input.payment_method_id,
      state: 'trialing',
      createdAt: this.now(),
      trialEndsAt,
      canceledAt: null,
      failedChargeCount: 0,
    };
    this.store.subscriptions.save(subscription);
    this.audit(id, 'created', null, 'trialing', `subscription created on plan '${planConfig.id}'`);

    if (planConfig.trialDays === 0) {
      await this.chargeAndApply(subscription, planConfig);
    }
    return this.store.subscriptions.get(id)!;
  }

  getSubscription(id: string): Subscription | undefined {
    return this.store.subscriptions.get(id);
  }

  async cancelSubscription(id: string): Promise<Subscription> {
    const sub = this.store.subscriptions.get(id);
    if (!sub) throw new ValidationError(`subscription '${id}' not found`);

    const next = SubscriptionStateMachine.nextState(sub.state, { kind: 'api_cancel' });
    if (next === null) return sub; 

    const from = sub.state;
    sub.state = next;
    sub.canceledAt = this.now();
    this.store.subscriptions.save(sub);
    this.audit(id, 'api_cancel', from, next, 'canceled via API');
    return sub;
  }


  async runBillingAttempt(subscriptionId: string): Promise<Subscription> {
    const sub = this.store.subscriptions.get(subscriptionId);
    if (!sub) throw new ValidationError(`subscription '${subscriptionId}' not found`);
    if (sub.state === 'canceled') throw new ValidationError('cannot bill a canceled subscription');

    const planConfig = PlanCatalog.get(sub.plan)!;
    return this.chargeAndApply(sub, planConfig);
  }

  private async chargeAndApply(sub: Subscription, planConfig: PlanConfig): Promise<Subscription> {
    const charge = await this.safeCharge({
      customerId: sub.customerId,
      paymentMethodId: sub.paymentMethodId,
      amountCents: planConfig.priceCents,
      currency: planConfig.currency,
      idempotencyKey: `${sub.id}:${randomUUID()}`,
    });
    this.recordInvoiceFromCharge(sub.id, planConfig.priceCents, planConfig.currency, charge);
    const eventType: WebhookEventType = charge.outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed';
    this.applyLifecycleEvent(sub.id, eventType, true);
    return this.store.subscriptions.get(sub.id)!;
  }

  private applyLifecycleEvent(
    subscriptionId: string,
    eventType: WebhookEventType,
    fromInternalCharge: boolean,
  ): void {
    const sub = this.store.subscriptions.get(subscriptionId);
    if (!sub) return;
    const action = fromInternalCharge ? 'billing_attempt' : 'webhook_event';
    const from = sub.state;
    const next = SubscriptionStateMachine.nextState(from, { kind: 'webhook', type: eventType });

    if (next !== null) {
      sub.state = next;
      if (eventType === 'payment.failed') sub.failedChargeCount += 1;
      if (eventType === 'payment.succeeded') sub.failedChargeCount = 0;
      if (next === 'canceled') sub.canceledAt = this.now();
      this.store.subscriptions.save(sub);
      this.audit(subscriptionId, action, from, next, `event '${eventType}'`);
      return;
    }

    if (from === 'past_due' && eventType === 'payment.failed') {
      sub.failedChargeCount += 1;
      this.store.subscriptions.save(sub);
      this.audit(subscriptionId, action, from, from, `retry failed (attempt ${sub.failedChargeCount})`);
      if (sub.failedChargeCount >= MAX_RETRIES) {
        const exhausted = SubscriptionStateMachine.nextState('past_due', { kind: 'retries_exhausted' });
        if (exhausted) {
          sub.state = exhausted;
          sub.canceledAt = this.now();
          this.store.subscriptions.save(sub);
          this.audit(subscriptionId, 'retries_exhausted', 'past_due', exhausted, `retries exhausted after ${sub.failedChargeCount} failures`);
        }
      }
      return;
    }

    if (eventType === 'payment.refunded') {
      this.markLastInvoiceRefunded(subscriptionId);
      this.audit(subscriptionId, action, from, from, "event 'payment.refunded' recorded on invoice, no lifecycle change");
      return;
    }


    this.audit(subscriptionId, action, from, from, `event '${eventType}' ignored: no valid transition from '${from}'`);
  }


  async processWebhook(payload: InboundWebhookPayload): Promise<{ noop: boolean }> {
    if (this.store.webhookEvents.hasProcessed(payload.event_id)) {
      this.saveWebhookEvent(payload, true);
      this.audit(payload.subscription_id, 'webhook_duplicate_ignored', null, null, `duplicate event_id '${payload.event_id}' ignored, not reprocessed`);
      return { noop: true };
    }

    const sub = this.store.subscriptions.get(payload.subscription_id);
    if (!sub) {
      this.saveWebhookEvent(payload, true);
      return { noop: true };
    }

    if (payload.type === 'payment.failed' && this.invoiceAlreadyResolvedSuccessfully(payload.subscription_id, payload.invoice_id)) {
      this.saveWebhookEvent(payload, true);
      this.audit(payload.subscription_id, 'webhook_stale_ignored', sub.state, sub.state, `stale/out-of-order payment.failed for invoice '${payload.invoice_id}', already resolved by an earlier payment.succeeded`);
      return { noop: true };
    }

    if (payload.type === 'payment.succeeded' || payload.type === 'payment.failed') {
      const next = SubscriptionStateMachine.nextState(sub.state, { kind: 'webhook', type: payload.type });
      const wouldApply = next !== null || (sub.state === 'past_due' && payload.type === 'payment.failed');
      if (wouldApply) this.recordInvoiceFromWebhook(payload);
    }

    const before = sub.state;
    this.applyLifecycleEvent(sub.id, payload.type, false);
    const after = this.store.subscriptions.get(sub.id)!.state;

    this.saveWebhookEvent(payload, before === after);
    return { noop: before === after };
  }

  private invoiceAlreadyResolvedSuccessfully(subscriptionId: string, invoiceId: string): boolean {
    return this.store.webhookEvents.forSubscription(subscriptionId)
      .some((e) => e.invoiceId === invoiceId && e.type === 'payment.succeeded' && !e.noop);
  }

  private recordInvoiceFromWebhook(payload: InboundWebhookPayload): void {
    const invoice: Invoice = {
      id: payload.invoice_id,
      subscriptionId: payload.subscription_id,
      amountCents: payload.amount,
      currency: payload.currency,
      status: payload.type === 'payment.succeeded' ? 'paid' : 'failed',
      createdAt: this.now(),
      providerChargeId: null,
    };
    this.store.invoices.save(invoice);
  }

  private saveWebhookEvent(payload: InboundWebhookPayload, noop: boolean): void {
    this.store.webhookEvents.save({
      eventId: payload.event_id,
      type: payload.type,
      subscriptionId: payload.subscription_id,
      invoiceId: payload.invoice_id,
      receivedAt: this.now(),
      processed: true,
      noop,
    });
  }
}
