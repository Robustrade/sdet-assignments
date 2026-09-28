import { PlanCatalog, type PlanPolicy } from '../domain/plans';
import type { Invoice, PaymentSource, Subscription } from '../domain/types';
import type { Repositories } from '../persistence/repositories';
import type { Clock } from '../ports/Clock';
import type { IdGenerator } from '../ports/IdGenerator';
import { PaymentProviderTimeoutError, type PaymentProvider } from '../ports/PaymentProvider';
import type { LifecycleManager } from './LifecycleManager';

export type BillingRunResult =
  | { action: 'skipped'; reason: string }
  | { action: 'charged'; invoiceId: string; outcome: 'succeeded' | 'declined' | 'unknown' };

export type SettleResult = { applied: true } | { applied: false; reason: string };

/**
 * Owns money movement. Two entry points:
 *  - runDue(): what a scheduler/cron would call. Creates invoices, calls the provider.
 *  - settle*(): apply a KNOWN outcome (from the provider response or a webhook).
 *
 * Rules that protect against double charging / double counting:
 *  - an invoice with an unresolved (pending) attempt is never charged again
 *  - a paid invoice ignores any later success/failure (out-of-order safe)
 *  - a failure webhook only counts if it resolves a pending attempt
 */
export class BillingEngine {
  constructor(
    private readonly repos: Repositories,
    private readonly catalog: PlanCatalog,
    private readonly provider: PaymentProvider,
    private readonly lifecycle: LifecycleManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async runDue(subscriptionId: string): Promise<BillingRunResult> {
    const sub = this.repos.subscriptions.getById(subscriptionId);
    const plan = this.catalog.get(sub.plan);
    const now = this.clock.now();
    const latest = this.repos.invoices.latestForSubscription(sub.id);

    if (latest && this.repos.payments.pendingForInvoice(latest.id)) {
      return { action: 'skipped', reason: 'charge_outcome_pending' };
    }

    switch (sub.status) {
      case 'canceled':
        return { action: 'skipped', reason: 'subscription_canceled' };
      case 'trialing':
        if (sub.trialEndsAt && now < new Date(sub.trialEndsAt)) {
          return { action: 'skipped', reason: 'trial_not_ended' };
        }
        return this.attemptCharge(sub, latest?.status === 'open' ? latest : this.openInvoice(sub, plan));
      case 'active':
        if (sub.currentPeriodEnd && now < new Date(sub.currentPeriodEnd)) {
          return { action: 'skipped', reason: 'period_not_ended' };
        }
        return this.attemptCharge(sub, this.openInvoice(sub, plan));
      case 'past_due': {
        if (!latest || latest.status !== 'failed') {
          return { action: 'skipped', reason: 'no_failed_invoice_to_retry' };
        }
        return this.attemptCharge(sub, latest);
      }
    }
  }

  private openInvoice(sub: Subscription, plan: PlanPolicy): Invoice {
    const now = this.clock.now().toISOString();
    return this.repos.invoices.insert({
      id: this.ids.next('inv'),
      subscriptionId: sub.id,
      amount: plan.priceCents,
      currency: plan.currency,
      status: 'open',
      attemptCount: 0,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async attemptCharge(sub: Subscription, invoice: Invoice): Promise<BillingRunResult> {
    const attempt = invoice.attemptCount + 1;
    const now = this.clock.now().toISOString();
    this.repos.invoices.update({ ...invoice, attemptCount: attempt, updatedAt: now });
    const idempotencyKey = `${invoice.id}:attempt-${attempt}`;

    try {
      const result = await this.provider.charge({
        amount: invoice.amount,
        currency: invoice.currency,
        customerId: sub.customerId,
        paymentMethodId: sub.paymentMethodId,
        subscriptionId: sub.id,
        invoiceId: invoice.id,
        idempotencyKey,
      });
      if (result.outcome === 'succeeded') {
        this.settleSuccess(sub.id, invoice.id, 'provider_call', result.providerChargeId, { attempt, idempotencyKey });
        return { action: 'charged', invoiceId: invoice.id, outcome: 'succeeded' };
      }
      this.settleFailure(sub.id, invoice.id, 'provider_call', result.declineCode, { attempt, idempotencyKey });
      return { action: 'charged', invoiceId: invoice.id, outcome: 'declined' };
    } catch (err) {
      // Timeout / network error: the charge MAY have happened. Record a pending
      // attempt and wait for the provider webhook. Never retry blindly.
      const reason = err instanceof PaymentProviderTimeoutError ? 'provider_timeout' : 'provider_error';
      this.repos.payments.insert({
        id: this.ids.next('pay'),
        invoiceId: invoice.id,
        subscriptionId: sub.id,
        amount: invoice.amount,
        currency: invoice.currency,
        status: 'pending',
        attempt,
        idempotencyKey,
        providerReference: null,
        source: 'provider_call',
        failureReason: reason,
        createdAt: now,
        updatedAt: now,
      });
      this.repos.audit.append({
        subscriptionId: sub.id,
        action: 'payment.outcome_unknown',
        fromStatus: sub.status,
        toStatus: sub.status,
        detail: `${invoice.id} ${reason}`,
        at: now,
      });
      return { action: 'charged', invoiceId: invoice.id, outcome: 'unknown' };
    }
  }

  settleSuccess(
    subscriptionId: string,
    invoiceId: string,
    source: PaymentSource,
    providerReference: string | null,
    attemptInfo?: { attempt: number; idempotencyKey: string },
  ): SettleResult {
    const invoice = this.repos.invoices.findById(invoiceId);
    if (!invoice) return { applied: false, reason: 'unknown_invoice' };
    if (invoice.status === 'paid' || invoice.status === 'refunded') {
      return { applied: false, reason: 'invoice_already_paid' };
    }
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const pending = this.repos.payments.pendingForInvoice(invoiceId);

    if (pending) {
      this.repos.payments.update({ ...pending, status: 'succeeded', providerReference, failureReason: null, updatedAt: nowIso });
    } else {
      this.repos.payments.insert({
        id: this.ids.next('pay'),
        invoiceId,
        subscriptionId,
        amount: invoice.amount,
        currency: invoice.currency,
        status: 'succeeded',
        attempt: attemptInfo?.attempt ?? null,
        idempotencyKey: attemptInfo?.idempotencyKey ?? null,
        providerReference,
        source,
        failureReason: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    this.repos.invoices.update({ ...invoice, status: 'paid', paidAt: nowIso, updatedAt: nowIso });

    const sub = this.repos.subscriptions.getById(subscriptionId); // re-read: may have changed during await
    if (sub.status === 'canceled') {
      this.repos.audit.append({
        subscriptionId, action: 'payment.succeeded_after_cancel', fromStatus: 'canceled', toStatus: 'canceled',
        detail: `${invoiceId} needs refund review`, at: nowIso,
      });
      return { applied: true };
    }
    const plan = this.catalog.get(sub.plan);
    this.lifecycle.apply(sub, 'PAYMENT_SUCCEEDED', `${source}:${invoiceId}`, {
      failedAttempts: 0,
      currentPeriodEnd: plan.nextPeriodEnd(now).toISOString(),
    });
    return { applied: true };
  }

  settleFailure(
    subscriptionId: string,
    invoiceId: string,
    source: PaymentSource,
    reason: string,
    attemptInfo?: { attempt: number; idempotencyKey: string },
  ): SettleResult {
    const invoice = this.repos.invoices.findById(invoiceId);
    if (!invoice) return { applied: false, reason: 'unknown_invoice' };
    if (invoice.status === 'paid' || invoice.status === 'refunded') {
      return { applied: false, reason: 'invoice_already_paid' }; // stale / out-of-order
    }
    const pending = this.repos.payments.pendingForInvoice(invoiceId);
    if (source === 'webhook' && !pending) {
      // We already know the outcome of every attempt (e.g. we got a sync decline).
      return { applied: false, reason: 'no_outstanding_attempt' };
    }
    const nowIso = this.clock.now().toISOString();
    if (pending) {
      this.repos.payments.update({ ...pending, status: 'failed', failureReason: reason, updatedAt: nowIso });
    } else {
      this.repos.payments.insert({
        id: this.ids.next('pay'),
        invoiceId,
        subscriptionId,
        amount: invoice.amount,
        currency: invoice.currency,
        status: 'failed',
        attempt: attemptInfo?.attempt ?? null,
        idempotencyKey: attemptInfo?.idempotencyKey ?? null,
        providerReference: null,
        source,
        failureReason: reason,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    this.repos.invoices.update({ ...invoice, status: 'failed', updatedAt: nowIso });

    const sub = this.repos.subscriptions.getById(subscriptionId);
    if (sub.status === 'canceled') return { applied: true };
    const plan = this.catalog.get(sub.plan);
    const failedAttempts = sub.failedAttempts + 1;
    const event =
      sub.status === 'past_due' && plan.isRetryBudgetExhausted(failedAttempts)
        ? 'RETRIES_EXHAUSTED'
        : 'PAYMENT_FAILED';
    this.lifecycle.apply(sub, event, `${source}:${invoiceId}:${reason}`, { failedAttempts });
    return { applied: true };
  }

  /** Assumption: a refund records money movement but does not change lifecycle state. */
  settleRefund(subscriptionId: string, invoiceId: string): SettleResult {
    const invoice = this.repos.invoices.findById(invoiceId);
    if (!invoice) return { applied: false, reason: 'unknown_invoice' };
    if (invoice.status !== 'paid') return { applied: false, reason: 'invoice_not_paid' };
    const nowIso = this.clock.now().toISOString();
    this.repos.payments.insert({
      id: this.ids.next('pay'),
      invoiceId,
      subscriptionId,
      amount: invoice.amount,
      currency: invoice.currency,
      status: 'refunded',
      attempt: null,
      idempotencyKey: null,
      providerReference: null,
      source: 'webhook',
      failureReason: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    this.repos.invoices.update({ ...invoice, status: 'refunded', updatedAt: nowIso });
    const sub = this.repos.subscriptions.getById(subscriptionId);
    this.repos.audit.append({
      subscriptionId, action: 'payment.refunded', fromStatus: sub.status, toStatus: sub.status, detail: invoiceId, at: nowIso,
    });
    return { applied: true };
  }
}
