import { randomUUID } from 'node:crypto';
import { nextState, type LifecycleEvent } from './lifecycle';
import type { ChargeResult, PaymentProvider } from './provider';
import type { AuditLogRepository, InvoiceRepository, SubscriptionRepository } from './store';
import { PLANS, type Invoice, type Subscription, type WebhookType } from './types';

export interface BillingDeps {
  provider: PaymentProvider;
  subscriptions: SubscriptionRepository;
  invoices: InvoiceRepository;
  audit: AuditLogRepository;
  now: () => number;
  maxRetries?: number;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/**
 * All state changes go through here, so the lifecycle guard is the only path
 * that can move a subscription. Webhook outcomes and direct charge outcomes
 * share the same transition table.
 */
export class BillingService {
  private readonly maxRetries: number;

  constructor(private readonly deps: BillingDeps) {
    this.maxRetries = deps.maxRetries ?? 3;
  }

  /** Applies one lifecycle event. Returns false when the transition is illegal. */
  private applyTransition(subscription: Subscription, event: LifecycleEvent, detail?: string): boolean {
    const to = nextState(subscription.state, event);
    if (to === null) return false;
    const from = subscription.state;
    subscription.state = to;
    subscription.updatedAt = this.deps.now();
    this.deps.subscriptions.save(subscription);
    this.deps.audit.append({ subscriptionId: subscription.id, kind: event, from, to, at: this.deps.now(), detail });
    return true;
  }

  private recordInvoice(
    subscription: Subscription,
    status: Invoice['status'],
    amountCents: number,
    reference: string,
  ): Invoice {
    const invoice: Invoice = {
      id: newId('inv'),
      subscriptionId: subscription.id,
      amountCents,
      currency: 'USD',
      status,
      reference,
      createdAt: this.deps.now(),
    };
    this.deps.invoices.save(invoice);
    return invoice;
  }

  /** Attempts the first charge for every trial that has ended. Test-driven (no HTTP trigger). */
  async processTrialEnds(): Promise<void> {
    const now = this.deps.now();
    for (const sub of this.listTrialingDue(now)) {
      await this.chargeTrial(sub);
    }
  }

  /** Test seam: trialing subscriptions whose trial ended at or before `now`. */
  private listTrialingDue(now: number): Subscription[] {
    return this.deps.subscriptions.listAll().filter((s) => s.state === 'trialing' && s.trialEndsAt <= now);
  }

  private async chargeTrial(subscription: Subscription): Promise<void> {
    const plan = PLANS[subscription.plan];
    const key = `trial-${subscription.id}`;
    const result: ChargeResult = await this.deps.provider.charge({
      customerId: subscription.customerId,
      paymentMethodId: subscription.paymentMethodId,
      amountCents: plan.priceCents,
      currency: 'USD',
      idempotencyKey: key,
    });
    if (result.outcome === 'success') {
      this.recordInvoice(subscription, 'paid', plan.priceCents, key);
      this.applyTransition(subscription, 'trial_charge_succeeded', 'first charge succeeded');
    } else if (result.outcome === 'decline') {
      this.recordInvoice(subscription, 'failed', plan.priceCents, key);
      this.applyTransition(subscription, 'trial_charge_failed', `first charge declined: ${result.reason}`);
    } else {
      this.deps.audit.append({
        subscriptionId: subscription.id,
        kind: 'charge_timeout',
        from: subscription.state,
        to: subscription.state,
        at: this.deps.now(),
        detail: 'first charge timed out; no state change',
      });
    }
  }

  /** Retries the charge for one past_due subscription. Returns false when not past_due. */
  async retryPastDue(subscription: Subscription): Promise<boolean> {
    if (subscription.state !== 'past_due') return false;
    const plan = PLANS[subscription.plan];
    const key = `retry-${subscription.id}-${subscription.retryCount + 1}`;
    const result: ChargeResult = await this.deps.provider.charge({
      customerId: subscription.customerId,
      paymentMethodId: subscription.paymentMethodId,
      amountCents: plan.priceCents,
      currency: 'USD',
      idempotencyKey: key,
    });
    if (result.outcome === 'success') {
      this.recordInvoice(subscription, 'paid', plan.priceCents, key);
      subscription.retryCount = 0;
      this.applyTransition(subscription, 'retry_succeeded', 'retry charge succeeded');
    } else if (result.outcome === 'decline') {
      this.recordInvoice(subscription, 'failed', plan.priceCents, key);
      subscription.retryCount += 1;
      this.deps.subscriptions.save(subscription);
      if (subscription.retryCount >= this.maxRetries) {
        this.applyTransition(subscription, 'retries_exhausted', `retries exhausted (${subscription.retryCount})`);
      } else {
        this.deps.audit.append({
          subscriptionId: subscription.id,
          kind: 'retry_failed',
          from: subscription.state,
          to: subscription.state,
          at: this.deps.now(),
          detail: `retry ${subscription.retryCount}/${this.maxRetries} declined`,
        });
      }
    } else {
      this.deps.audit.append({
        subscriptionId: subscription.id,
        kind: 'charge_timeout',
        from: subscription.state,
        to: subscription.state,
        at: this.deps.now(),
        detail: 'retry charge timed out; no state change',
      });
    }
    return true;
  }

  /** Cancels a subscription. Returns null when cancel is not allowed from its state. */
  cancel(subscription: Subscription): Subscription | null {
    if (!this.applyTransition(subscription, 'cancel', 'canceled via API')) return null;
    return subscription;
  }

  /**
   * Applies a verified, not-yet-processed webhook. The caller owns signature
   * verification and duplicate detection; this method records the event and
   * applies its business effect exactly once.
   */
  applyWebhook(
    record: { eventId: string; type: WebhookType; subscriptionId: string; invoiceId?: string; amountCents: number; currency: string },
    markProcessed: (eventId: string) => void,
  ): { outcome: 'applied' | 'ignored'; reason?: string } {
    const sub = this.deps.subscriptions.findById(record.subscriptionId);
    if (!sub) return { outcome: 'ignored', reason: 'subscription_not_found' };
    markProcessed(record.eventId);

    if (record.type === 'payment.succeeded') {
      if (sub.state === 'canceled') return { outcome: 'ignored', reason: 'subscription_canceled' };
      const existing = record.invoiceId ? this.deps.invoices.findByReference(record.invoiceId) : undefined;
      if (existing && existing.status === 'paid') return { outcome: 'ignored', reason: 'invoice_already_paid' };
      if (!existing && record.invoiceId) {
        this.recordInvoice(sub, 'paid', record.amountCents, record.invoiceId);
      }
      if (sub.state === 'trialing') this.applyTransition(sub, 'trial_charge_succeeded', `webhook ${record.eventId}`);
      else if (sub.state === 'past_due') {
        sub.retryCount = 0;
        this.applyTransition(sub, 'retry_succeeded', `webhook ${record.eventId}`);
      }
      return { outcome: 'applied' };
    }

    if (record.type === 'payment.failed') {
      if (sub.state === 'canceled') return { outcome: 'ignored', reason: 'subscription_canceled' };
      const existing = record.invoiceId ? this.deps.invoices.findByReference(record.invoiceId) : undefined;
      if (existing && existing.status === 'paid') {
        // A late failure for an already-succeeded invoice must not regress state.
        return { outcome: 'ignored', reason: 'invoice_already_paid' };
      }
      if (!existing && record.invoiceId) {
        this.recordInvoice(sub, 'failed', record.amountCents, record.invoiceId);
      }
      if (sub.state === 'trialing') {
        this.applyTransition(sub, 'trial_charge_failed', `webhook ${record.eventId}`);
      } else if (sub.state === 'active') {
        this.applyTransition(sub, 'recurring_charge_failed', `webhook ${record.eventId}`);
      } else if (sub.state === 'past_due') {
        sub.retryCount += 1;
        this.deps.subscriptions.save(sub);
        if (sub.retryCount >= this.maxRetries) {
          this.applyTransition(sub, 'retries_exhausted', `webhook ${record.eventId}`);
        }
      }
      return { outcome: 'applied' };
    }

    // payment.refunded: record the refund, never regress state.
    if (record.invoiceId) {
      const existing = this.deps.invoices.findByReference(record.invoiceId);
      if (existing && existing.status === 'paid') {
        existing.status = 'refunded';
        this.deps.invoices.save(existing);
      }
    }
    return { outcome: 'applied' };
  }
}
