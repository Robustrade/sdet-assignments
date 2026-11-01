import { Database, Subscription } from './database';
import { PaymentProvider, ProviderTimeoutError } from './paymentProvider';
import { DAY_MS, PLANS } from './plans';
import { InvalidTransitionError } from './stateMachine';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export const MAX_FAILED_PAYMENTS = 3; // first failure + 2 retries, then cancel

export interface WebhookEvent {
  event_id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export class BillingService {
  constructor(
    private db: Database,
    private provider: PaymentProvider,
    private now: () => Date,
  ) {}

  // API: create
  async createSubscription(body: any): Promise<Subscription> {
    for (const field of ['customer_id', 'plan', 'payment_method_id']) {
      if (typeof body?.[field] !== 'string' || body[field] === '') throw new HttpError(400, 'missing_field', field);
    }
    const plan = PLANS[body.plan];
    if (!plan) throw new HttpError(422, 'unknown_plan');
    const customer = this.db.getCustomer(body.customer_id);
    if (!customer) throw new HttpError(422, 'unknown_customer');
    if (!customer.paymentMethods.includes(body.payment_method_id)) throw new HttpError(422, 'invalid_payment_method');

    const now = this.now();
    const sub: Subscription = {
      id: this.db.newId('sub'),
      customerId: customer.id,
      plan: plan.name,
      status: 'trialing', // every subscription starts here
      paymentMethodId: body.payment_method_id,
      trialEndsAt: new Date(now.getTime() + plan.trialDays * DAY_MS).toISOString(),
      failedPayments: 0,
      createdAt: now.toISOString(),
      canceledAt: null,
    };
    this.db.addSubscription(sub);

    // No trial = Get plan now
    if (plan.trialDays === 0) await this.collectPayment(sub);
    return this.db.getSubscription(sub.id)!;
  }

  // API: get / cancel
  getSubscription(id: string): Subscription {
    const sub = this.db.getSubscription(id);
    if (!sub) throw new HttpError(404, 'not_found');
    return sub;
  }

  cancel(id: string): Subscription {
    this.getSubscription(id);
    try {
      this.db.applyEvent(id, 'CANCEL', this.now().toISOString());
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new HttpError(409, 'invalid_transition', e.message);
      throw e;
    }
    return this.db.getSubscription(id)!;
  }

  // Scheduler: charge (trial end / renewal / retry)
  async chargeNow(id: string) {
    const sub = this.getSubscription(id);
    if (sub.status === 'canceled') throw new HttpError(409, 'subscription_canceled');
    if (sub.status === 'trialing' && this.now() < new Date(sub.trialEndsAt)) throw new HttpError(409, 'trial_not_ended');
    // After a timeout we do not know if the customer paid. Charging again could charge them twice.
    if (this.db.invoicesOf(id).some((i) => i.status === 'pending')) throw new HttpError(409, 'payment_in_progress');
    return this.collectPayment(sub);
  }

  private async collectPayment(sub: Subscription) {
    const plan = PLANS[sub.plan];
    const attempt = this.db.invoicesOf(sub.id).length + 1;
    const invoiceId = this.db.newId('inv');
    this.db.addInvoice({
      id: invoiceId,
      subscriptionId: sub.id,
      amount: plan.priceCents,
      currency: plan.currency,
      status: 'pending',
      attempt,
      idempotencyKey: `${sub.id}-attempt-${attempt}`,
      note: null,
    });

    let outcome: 'succeeded' | 'declined' | 'unknown';
    try {
      const res = await this.provider.charge({
        subscriptionId: sub.id,
        invoiceId,
        customerId: sub.customerId,
        paymentMethodId: sub.paymentMethodId,
        amount: plan.priceCents,
        currency: plan.currency,
        idempotencyKey: `${sub.id}-attempt-${attempt}`,
      });
      if (res.result === 'succeeded') {
        this.db.updateInvoice(invoiceId, { status: 'paid' });
        this.paymentSucceeded(sub.id);
        outcome = 'succeeded';
      } else {
        this.db.updateInvoice(invoiceId, { status: 'failed', note: res.reason });
        this.paymentFailed(sub.id);
        outcome = 'declined';
      }
    } catch (e) {
      if (!(e instanceof ProviderTimeoutError)) throw e;
      // Unknown result: keep invoice pending, do not change status. A webhook will tell us later.
      this.db.updateInvoice(invoiceId, { note: 'provider_timeout' });
      outcome = 'unknown';
    }
    return { outcome, subscription: this.db.getSubscription(sub.id)!, invoice: this.db.getInvoice(invoiceId)! };
  }

  private paymentSucceeded(subId: string) {
    this.db.applyEvent(subId, 'PAYMENT_SUCCEEDED', this.now().toISOString());
    this.db.setFailedPayments(subId, 0);
  }

  private paymentFailed(subId: string) {
    const sub = this.db.getSubscription(subId)!;
    const failures = sub.failedPayments + 1;
    this.db.setFailedPayments(subId, failures);
    const giveUp = sub.status === 'past_due' && failures >= MAX_FAILED_PAYMENTS;
    this.db.applyEvent(subId, giveUp ? 'RETRIES_EXHAUSTED' : 'PAYMENT_FAILED', this.now().toISOString());
  }

  // Webhooks from the payment provider
  handleWebhook(event: WebhookEvent): { status: 'applied' | 'ignored' | 'duplicate'; reason: string | null } {
    // 1. Seen this event before? Count it and do nothing else.
    if (this.db.getWebhookEvent(event.event_id)) {
      this.db.countRepeat(event.event_id);
      return { status: 'duplicate', reason: 'already_processed' };
    }
    // 2. Decide what to do, then record the event (applied or ignored, with the reason).
    const decision = this.decide(event);
    this.db.addWebhookEvent({
      eventId: event.event_id,
      type: event.type,
      invoiceId: event.invoice_id,
      result: decision.status,
      reason: decision.reason,
      timesReceived: 1,
    });
    return decision;
  }

  private decide(event: WebhookEvent): { status: 'applied' | 'ignored'; reason: string | null } {
    const ignore = (reason: string) => ({ status: 'ignored' as const, reason });
    const sub = this.db.getSubscription(event.subscription_id);
    if (!sub) return ignore('unknown_subscription');
    const invoice = this.db.getInvoice(event.invoice_id);
    if (!invoice || invoice.subscriptionId !== sub.id) return ignore('unknown_invoice');
    if (event.amount !== invoice.amount || event.currency !== invoice.currency) return ignore('amount_mismatch');

    if (event.type === 'payment.refunded') {
      if (invoice.status !== 'paid') return ignore('invoice_not_paid');
      this.db.updateInvoice(invoice.id, { status: 'refunded' });
      this.db.audit(sub.id, 'REFUNDED', null, null, this.now().toISOString());
      return { status: 'applied', reason: null };
    }

    if (sub.status === 'canceled') return ignore('subscription_canceled'); // canceled never comes back
    // Invoice already settled (paid/failed/refunded)? Then this is late or repeated news: ignore it.
    if (invoice.status !== 'pending') return ignore(`invoice_already_${invoice.status}`);

    if (event.type === 'payment.succeeded') {
      this.db.updateInvoice(invoice.id, { status: 'paid', note: null });
      this.paymentSucceeded(sub.id);
    } else {
      this.db.updateInvoice(invoice.id, { status: 'failed', note: 'reported_by_webhook' });
      this.paymentFailed(sub.id);
    }
    return { status: 'applied', reason: null };
  }
}
