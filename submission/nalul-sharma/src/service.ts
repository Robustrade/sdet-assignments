import { randomUUID } from 'node:crypto';
import { PLANS, SubscriptionLifecycleStateMachine } from './domain.ts';
import type { Invoice, PaymentWebhook, Plan, Subscription, Trigger } from './domain.ts';
import type { SubscriptionBillingRepository } from './repository.ts';
import type { PaymentGateway } from './provider.ts';
export class SubscriptionBillingDomainError extends Error { statusCode: number; constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; } }
const now = () => new Date().toISOString();
export class SubscriptionBillingService {
  private stateMachine = new SubscriptionLifecycleStateMachine();
  readonly db: SubscriptionBillingRepository; private paymentGateway: PaymentGateway;
  constructor(db: SubscriptionBillingRepository, paymentGateway: PaymentGateway) { this.db = db; this.paymentGateway = paymentGateway; }
  private transitionSubscriptionStatus(sub: Subscription, trigger: Trigger): boolean {
    const next = this.stateMachine.getNextStatus(sub.status, trigger);
    if (!next) return false;
    const previous = sub.status;
    sub.status = next; sub.updatedAt = now();
    this.db.audit.push({ subscriptionId: sub.id, from: previous, to: next, reason: trigger, at: now() });
    return true;
  }
  createSubscription(input: unknown): Subscription {
    if (!input || typeof input !== 'object') throw new SubscriptionBillingDomainError(400, 'Invalid body');
    const body = input as Record<string, unknown>;
    if (typeof body.customer_id !== 'string' || !['cust_001','cust_002'].includes(body.customer_id)) throw new SubscriptionBillingDomainError(422, 'Unknown customer');
    if (typeof body.plan !== 'string' || !(body.plan in PLANS)) throw new SubscriptionBillingDomainError(422, 'Unknown plan');
    if (typeof body.payment_method_id !== 'string' || !body.payment_method_id.startsWith('pm_test_')) throw new SubscriptionBillingDomainError(422, 'Invalid payment method');
    const plan = body.plan as Plan; const id = `sub_${randomUUID()}`;
    const sub: Subscription = { id, customerId: body.customer_id, plan,
      paymentMethodId: body.payment_method_id, status: 'trialing',
      trialEndsAt: new Date(Date.now() + PLANS[plan].trialDays * 86400000).toISOString(),
      createdAt: now(), updatedAt: now() };
    this.db.subscriptions.set(id, sub);
    this.db.audit.push({ subscriptionId: id, from: null, to: 'trialing', reason: 'created', at: now() });
    return sub;
  }
  getSubscriptionById(id: string): Subscription {
    const sub = this.db.subscriptions.get(id);
    if (!sub) throw new SubscriptionBillingDomainError(404, 'Subscription not found');
    return sub;
  }
  cancelSubscription(id: string): Subscription {
    const sub = this.getSubscriptionById(id);
    if (!this.transitionSubscriptionStatus(sub, 'cancel')) throw new SubscriptionBillingDomainError(409, 'Invalid cancellation transition');
    return sub;
  }
  /** Explicit fixture endpoint, not a production public API: simulate a billing attempt. */
  async attemptSubscriptionCharge(id: string): Promise<{ subscription: Subscription; invoice: Invoice; outcome: string }> {
    const sub = this.getSubscriptionById(id);
    if (sub.status === 'canceled') throw new SubscriptionBillingDomainError(409, 'Canceled subscriptions cannot be billed');
    const invoiceId = `inv_${randomUUID()}`; const at = now();
    const invoice: Invoice = { id: invoiceId, subscriptionId: id, amount: PLANS[sub.plan].price,
      currency: 'USD', status: 'pending', createdAt: at, updatedAt: at };
    this.db.invoices.set(invoiceId, invoice);
    try {
      const result = await this.paymentGateway.submitCharge({ subscriptionId: id, invoiceId,
        customerId: sub.customerId, paymentMethodId: sub.paymentMethodId,
        amount: invoice.amount, currency: 'USD', idempotencyKey: invoiceId });
      if (result.outcome === 'success') {
        invoice.status = 'paid'; invoice.updatedAt = now(); this.transitionSubscriptionStatus(sub, 'charge_success');
      } else {
        invoice.status = 'failed'; invoice.updatedAt = now(); this.transitionSubscriptionStatus(sub, 'charge_failure');
      }
      return { subscription: sub, invoice, outcome: result.outcome };
    } catch (err) {
      if ((err as Error).message !== 'PROVIDER_TIMEOUT') throw err;
      return { subscription: sub, invoice, outcome: 'unknown' };
    }
  }
  markSubscriptionRetriesExhausted(id: string): Subscription {
    const sub = this.getSubscriptionById(id);
    if (!this.transitionSubscriptionStatus(sub, 'retry_exhausted')) throw new SubscriptionBillingDomainError(409, 'Invalid retry transition');
    return sub;
  }
  processPaymentWebhook(event: PaymentWebhook): { disposition: 'applied' | 'ignored' | 'duplicate' } {
    const at = now();
    if (this.db.webhookEvents.has(event.event_id)) {
      this.db.webhookDeliveries.push({ eventId: event.event_id, disposition: 'duplicate', at });
      return { disposition: 'duplicate' };
    }
    const sub = this.db.subscriptions.get(event.subscription_id);
    const invoice = this.db.invoices.get(event.invoice_id);
    if (!sub || !invoice || invoice.subscriptionId !== sub.id || invoice.amount !== event.amount || invoice.currency !== event.currency)
      throw new SubscriptionBillingDomainError(422, 'Webhook references do not match an invoice');
    let disposition: 'applied' | 'ignored' = 'ignored';
    if (sub.status !== 'canceled') {
      if (event.type === 'payment.succeeded' && (invoice.status === 'pending' || invoice.status === 'failed')) {
        // A previously failed invoice may be settled by a subsequent success (reconciliation).
        if (this.transitionSubscriptionStatus(sub, 'charge_success')) {
          invoice.status = 'paid'; invoice.updatedAt = now(); disposition = 'applied';
        }
      } else if (event.type === 'payment.failed' && invoice.status === 'pending') {
        if (this.transitionSubscriptionStatus(sub, 'charge_failure')) {
          invoice.status = 'failed'; invoice.updatedAt = now(); disposition = 'applied';
        }
      } else if (event.type === 'payment.refunded' && invoice.status === 'paid') {
        // Refund does not imply a lifecycle transition in the supplied diagram.
        invoice.status = 'refunded'; invoice.updatedAt = now(); disposition = 'applied';
      }
    }
    this.db.webhookEvents.set(event.event_id, { eventId: event.event_id, type: event.type,
      invoiceId: invoice.id, subscriptionId: sub.id, disposition, receivedAt: at });
    this.db.webhookDeliveries.push({ eventId: event.event_id, disposition, at });
    return { disposition };
  }
}
