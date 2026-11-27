import { LifecycleTrigger, SubscriptionLifecycle } from '../domain/lifecycle';
import { PlanCatalog } from '../domain/plans';
import { ChangeSource, ChargeAttempt, Invoice, Subscription } from '../domain/types';
import { Repositories } from '../persistence/repositories';
import { IdGenerator } from './ids';

export interface PaymentOutcome {
  subscription: Subscription;
  invoice: Invoice;
  result: 'succeeded' | 'declined';
  providerChargeId: string | null;
  failureReason?: string | null;
  /** The attempt we made, when we know it (synchronous path). Webhooks resolve it by provider charge id. */
  attempt?: ChargeAttempt;
  source: ChangeSource;
  /** What caused this (attempt id, webhook event id). Stored on audit entries. */
  reference: string;
  at: string;
}

export type ApplyResult = { applied: true } | { applied: false; reason: string };

/**
 * Applies a payment result to invoice, attempt and subscription. Both the synchronous
 * charge path and webhooks go through here, so "what a success/failure means" is decided once.
 * Callers must run this inside a transaction.
 */
export class PaymentOutcomes {
  constructor(
    private readonly repos: Repositories,
    private readonly plans: PlanCatalog,
    private readonly ids: IdGenerator,
  ) {}

  apply(outcome: PaymentOutcome): ApplyResult {
    if (outcome.subscription.status === 'canceled') return { applied: false, reason: 'subscription_canceled' };
    if (outcome.invoice.status !== 'open') return { applied: false, reason: `invoice_${outcome.invoice.status}` };

    const attempt = this.resolveAttempt(outcome);
    if (attempt === 'already_settled') return { applied: false, reason: 'attempt_already_settled' };

    if (outcome.result === 'succeeded') {
      this.repos.attempts.settle(attempt.id, 'succeeded', outcome.providerChargeId, null, outcome.at);
      this.onSuccess(outcome, attempt);
    } else {
      this.repos.attempts.settle(attempt.id, 'declined', outcome.providerChargeId, outcome.failureReason ?? 'declined', outcome.at);
      this.onFailure(outcome, attempt);
    }
    return { applied: true };
  }

  /**
   * A result for one of OUR attempts arrived but can no longer be applied (the subscription was
   * canceled or the invoice closed while the charge was in flight). The attempt is still settled so
   * the record matches what the provider did - and if money was taken, it is flagged for refund.
   */
  recordUnappliedResult(outcome: PaymentOutcome & { attempt: ChargeAttempt }): void {
    const status = outcome.result === 'succeeded' ? 'succeeded' : 'declined';
    if (!this.repos.attempts.settle(outcome.attempt.id, status, outcome.providerChargeId, outcome.failureReason ?? null, outcome.at)) return;
    if (outcome.result !== 'succeeded') return;
    this.repos.audit.append({
      subscriptionId: outcome.subscription.id,
      action: 'charge_requires_refund',
      source: outcome.source,
      reference: outcome.attempt.id,
      at: outcome.at,
    });
    this.repos.notifications.record(outcome.subscription.id, 'refund_required', outcome.attempt.id, outcome.at);
  }

  private resolveAttempt(outcome: PaymentOutcome): ChargeAttempt | 'already_settled' {
    const known =
      outcome.attempt ?? (outcome.providerChargeId ? this.repos.attempts.findByProviderChargeId(outcome.providerChargeId) : undefined);
    if (known) {
      const fresh = this.repos.attempts.findById(known.id);
      return fresh && (fresh.status === 'pending' || fresh.status === 'unknown') ? fresh : 'already_settled';
    }

    // An attempt we did not start ourselves (e.g. the provider retried on its own, or a timed-out
    // request whose charge id we never learned). Record it so the payment history is complete.
    const pendingOrUnknown = this.repos.attempts
      .findByInvoice(outcome.invoice.id)
      .find((a) => a.status === 'pending' || a.status === 'unknown');
    if (pendingOrUnknown) return pendingOrUnknown;

    const attemptNo = this.repos.attempts.findByInvoice(outcome.invoice.id).length + 1;
    const id = this.ids.next('att');
    this.repos.attempts.insert({
      id,
      invoiceId: outcome.invoice.id,
      attemptNo,
      idempotencyKey: `provider:${outcome.providerChargeId ?? id}`,
      amountCents: outcome.invoice.amountCents,
      createdAt: outcome.at,
    });
    return this.repos.attempts.findById(id) as ChargeAttempt;
  }

  private onSuccess(outcome: PaymentOutcome, attempt: ChargeAttempt): void {
    this.repos.invoices.transition(outcome.invoice.id, 'paid', outcome.at);
    this.repos.subscriptions.updatePeriod(outcome.subscription.id, outcome.invoice.periodStart, outcome.invoice.periodEnd, outcome.at);
    this.repos.audit.append({
      subscriptionId: outcome.subscription.id,
      action: 'payment_succeeded',
      source: outcome.source,
      reference: attempt.id,
      at: outcome.at,
    });
    this.repos.notifications.record(outcome.subscription.id, 'payment_receipt', attempt.id, outcome.at);
    this.move(outcome.subscription, 'payment_succeeded', outcome);
  }

  private onFailure(outcome: PaymentOutcome, attempt: ChargeAttempt): void {
    const plan = this.plans.get(outcome.subscription.plan);
    const failed = outcome.invoice.failedAttempts + 1;
    const nextRetryAt = plan.nextRetryAt(failed, outcome.at);
    this.repos.invoices.recordFailure(outcome.invoice.id, failed, nextRetryAt, outcome.at);
    this.repos.audit.append({
      subscriptionId: outcome.subscription.id,
      action: 'payment_failed',
      source: outcome.source,
      reference: attempt.id,
      at: outcome.at,
    });
    this.repos.notifications.record(outcome.subscription.id, 'payment_failed', attempt.id, outcome.at);

    const afterFailure = this.move(outcome.subscription, 'payment_failed', outcome);
    if (nextRetryAt === null) {
      this.move(afterFailure, 'retries_exhausted', outcome, 'retries_exhausted');
      this.repos.invoices.transition(outcome.invoice.id, 'collection_failed', outcome.at);
    }
  }

  /** Ask the lifecycle, persist the move if approved, and audit it. Returns the subscription as it now is. */
  private move(sub: Subscription, trigger: LifecycleTrigger, outcome: PaymentOutcome, cancelReason?: string): Subscription {
    const decision = SubscriptionLifecycle.decide(sub.id, sub.status, trigger);
    if (decision.kind === 'rejected') {
      throw new Error(`Lifecycle rejected ${trigger} from ${sub.status} for ${sub.id}`);
    }
    if (decision.kind === 'unchanged') return sub;

    const t = decision.transition;
    this.repos.subscriptions.applyTransition(t, outcome.at, cancelReason);
    this.repos.audit.append({
      subscriptionId: sub.id,
      action: 'status_changed',
      fromStatus: t.from,
      toStatus: t.to,
      source: outcome.source,
      reference: outcome.reference,
      at: outcome.at,
    });
    if (t.to === 'canceled') this.repos.notifications.record(sub.id, 'subscription_canceled', sub.id, outcome.at);
    return { ...sub, status: t.to };
  }
}
