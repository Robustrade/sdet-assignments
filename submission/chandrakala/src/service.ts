import { createHash, randomUUID } from 'node:crypto';
import {
  DomainError, SubscriptionLifecycle, ProviderTimeout, plans, isObject, isPlan,
  type Clock, type Invoice, type PaymentProvider, type Subscription,
  type WebhookEvent, type WebhookType, type Trigger,
} from './domain.ts';
import { BillingRepository } from './repository.ts';

export class BillingService {
  private readonly lifecycle = new SubscriptionLifecycle();
  constructor(
    private readonly repo: BillingRepository,
    private readonly provider: PaymentProvider,
    private readonly clock: Clock,
  ) {}
  private now(): string { return this.clock.now().toISOString(); }
  get(id: string): Subscription {
    const s = this.repo.subscription(id);
    if (!s) throw new DomainError(404, 'Subscription not found');
    return s;
  }
  private transition(s: Subscription, trigger: Trigger): void {
    const from = s.status;
    s.status = this.lifecycle.next(s.status, trigger);
    s.updated_at = this.now();
    this.repo.saveSubscription(s);
    this.repo.audit(s.id, trigger, from, s.status, this.now());
  }
  async create(data: unknown) {
    if (!isObject(data) || !isPlan(data.plan) || typeof data.customer_id !== 'string' ||
        !data.customer_id.trim() || typeof data.payment_method_id !== 'string' ||
        !/^pm_test_[A-Za-z0-9_]+$/.test(data.payment_method_id)) {
      throw new DomainError(400, 'Valid customer_id, plan and payment_method_id are required');
    }
    if (!this.repo.hasCustomer(data.customer_id)) throw new DomainError(404, 'Customer not found');
    const now = this.now();
    const s: Subscription = {
      id: `sub_${randomUUID()}`, customer_id: data.customer_id,
      payment_method_id: data.payment_method_id, plan: data.plan, status: 'trialing',
      trial_end: new Date(this.clock.now().getTime() + plans[data.plan].trialDays * 86400000).toISOString(),
      failures: 0, created_at: now, updated_at: now,
    };
    this.repo.transaction(() => {
      this.repo.addSubscription(s);
      this.repo.audit(s.id, 'created', '', 'trialing', now);
    });
    if (plans[s.plan].trialDays === 0) return this.bill(s.id);
    return { subscription: s, invoice: null, pending: false };
  }
  cancel(id: string): Subscription {
    return this.repo.transaction(() => {
      const s = this.get(id);
      this.transition(s, 'cancel');
      return s;
    });
  }
  changePlan(id: string, data: unknown): Subscription {
    if (!isObject(data) || !isPlan(data.plan)) throw new DomainError(400, 'Invalid plan');
    const plan = data.plan;
    return this.repo.transaction(() => {
      const s = this.get(id);
      if (!['trialing','active'].includes(s.status) || this.repo.invoices(id).some(i => i.status === 'pending')) {
        throw new DomainError(409, 'Plan cannot change in the current state');
      }
      s.plan = plan;
      s.updated_at = this.now();
      this.repo.saveSubscription(s);
      this.repo.audit(id, `plan:${plan}`, s.status, s.status, this.now());
      return s;
    });
  }
  async bill(id: string) {
    // Reserve the attempt before awaiting the provider; concurrent callers reuse it.
    const attempt = this.repo.transaction(() => {
      const s = this.get(id);
      if (s.status === 'canceled') throw new DomainError(409, 'Canceled subscriptions cannot be billed');
      if (s.status === 'trialing' && this.now() < s.trial_end) throw new DomainError(409, 'Trial has not ended');
      const previous = this.repo.invoices(id);
      const pending = previous.find(i => i.status === 'pending');
      if (pending) return { s, invoice: pending, reserved: false };
      const invoice: Invoice = {
        id: `inv_${randomUUID()}`, subscription_id: id, sequence: previous.length + 1,
        amount: plans[s.plan].price, currency: 'USD', status: 'pending',
        created_at: this.now(), updated_at: this.now(),
      };
      this.repo.addInvoice(invoice);
      this.repo.audit(id, 'billing_attempt', s.status, s.status, this.now());
      return { s, invoice, reserved: true };
    });
    if (attempt.reserved) {
      try {
        const outcome = await this.provider.charge({
          customerId: attempt.s.customer_id, paymentMethodId: attempt.s.payment_method_id,
          amount: attempt.invoice.amount, currency: 'USD', invoiceId: attempt.invoice.id,
          idempotencyKey: attempt.invoice.id,
        });
        this.repo.transaction(() => this.reconcile(attempt.invoice.id,
          outcome === 'success' ? 'payment.succeeded' : 'payment.failed'));
      } catch (error) {
        if (!(error instanceof ProviderTimeout)) throw error;
        // Unknown is not decline. Webhook reconciliation resolves the pending invoice.
        this.repo.audit(id, 'provider_timeout', this.get(id).status, this.get(id).status, this.now());
      }
    }
    const invoice = this.repo.invoice(attempt.invoice.id)!;
    return { subscription: this.get(id), invoice, pending: invoice.status === 'pending' };
  }

  /** Called only inside a transaction. Never regress a settled invoice or terminal lifecycle. */
  private reconcile(invoiceId: string, type: WebhookType): 'applied' | 'ignored' {
    const invoice = this.repo.invoice(invoiceId)!;
    const s = this.get(invoice.subscription_id);
    const payment = type.slice('payment.'.length) as 'succeeded' | 'failed' | 'refunded';
    const target = payment === 'succeeded' ? 'paid' : payment;
    if (invoice.status === target || invoice.status === 'refunded' ||
        (invoice.status === 'paid' && target === 'failed') ||
        (target === 'refunded' && invoice.status !== 'paid')) return 'ignored';
    invoice.status = target;
    invoice.updated_at = this.now();
    this.repo.saveInvoice(invoice);
    this.repo.addPayment(invoice.id, payment, this.now());
    this.repo.audit(s.id, type, s.status, s.status, this.now());

    const latest = this.repo.invoices(s.id).at(-1)!;
    if (latest.id !== invoice.id || s.status === 'canceled' || target === 'refunded') return 'applied';
    if (target === 'paid') {
      s.failures = 0;
      if (s.status === 'active') {
        s.updated_at = this.now(); this.repo.saveSubscription(s);
      } else this.transition(s, 'paid');
    } else {
      s.failures += 1;
      if (s.status !== 'past_due') this.transition(s, 'failed');
      else { s.updated_at = this.now(); this.repo.saveSubscription(s); }
      if (s.failures >= 3) this.transition(s, 'exhausted');
    }
    return 'applied';
  }

  webhook(raw: Buffer): {outcome: string} {
    let data: unknown;
    try { data = JSON.parse(raw.toString('utf8')); }
    catch { throw new DomainError(400, 'Malformed JSON'); }
    if (!isObject(data) || !['payment.succeeded','payment.failed','payment.refunded'].includes(String(data.type)) ||
        !['event_id','subscription_id','invoice_id'].every(k => typeof data[k] === 'string' && !!data[k]) ||
        !Number.isSafeInteger(data.amount) || Number(data.amount) <= 0 || data.currency !== 'USD') {
      throw new DomainError(400, 'Malformed or unsupported webhook');
    }
    const event = data as unknown as WebhookEvent;
    const hash = createHash('sha256').update(raw).digest('hex');
    return this.repo.transaction(() => {
      const seen = this.repo.event(event.event_id);
      if (seen) {
        if (seen.payload_hash !== hash) throw new DomainError(409, 'Event ID reused with different content');
        this.repo.recordDelivery(event.event_id, 'duplicate', this.now());
        return { outcome: 'duplicate' };
      }
      this.get(event.subscription_id);
      const invoice = this.repo.invoice(event.invoice_id);
      if (!invoice) throw new DomainError(404, 'Invoice not found');
      if (invoice.subscription_id !== event.subscription_id || invoice.amount !== event.amount ||
          invoice.currency !== event.currency) throw new DomainError(409, 'Invoice does not match webhook');
      const outcome = this.reconcile(invoice.id, event.type);
      this.repo.recordEvent(event, hash, outcome, this.now());
      this.repo.recordDelivery(event.event_id, outcome, this.now());
      return { outcome };
    });
  }
}
