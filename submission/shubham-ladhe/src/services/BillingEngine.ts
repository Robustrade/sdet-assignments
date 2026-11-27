import { PlanCatalog } from '../domain/plans';
import { addDays, Clock, isAtOrBefore } from '../domain/time';
import { ChangeSource, ChargeAttempt, CURRENCY, Invoice, Subscription } from '../domain/types';
import { GatewayTimeoutError, PaymentGateway } from '../payments/PaymentGateway';
import { Repositories } from '../persistence/repositories';
import { SqlDatabase } from '../persistence/SqlDatabase';
import { IdGenerator } from './ids';
import { PaymentOutcomes } from './PaymentOutcomes';

export interface BillingRunSummary {
  invoicesOpened: number;
  chargesSent: number;
  resends: number;
  recordingFailures: number;
}

/**
 * Talks to the payment provider. The rule that keeps charges safe under retries and races:
 * the attempt row (with its idempotency key) is written and committed *before* the provider
 * is called, so a second caller sees it and backs off instead of charging again.
 */
export class BillingEngine {
  constructor(
    private readonly db: SqlDatabase,
    private readonly repos: Repositories,
    private readonly plans: PlanCatalog,
    private readonly gateway: PaymentGateway,
    private readonly outcomes: PaymentOutcomes,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Open the invoice for a billing period. Must be called inside a transaction. */
  openInvoice(sub: Subscription, periodStart: string, source: ChangeSource): Invoice {
    const plan = this.plans.get(sub.plan);
    const id = this.ids.next('inv');
    const now = this.clock.now();
    this.repos.invoices.insert({
      id,
      subscriptionId: sub.id,
      amountCents: plan.priceCents,
      currency: CURRENCY,
      periodStart,
      periodEnd: addDays(periodStart, plan.billingPeriodDays),
      createdAt: now,
    });
    this.repos.audit.append({ subscriptionId: sub.id, action: 'invoice_opened', source, reference: id, at: now });
    return this.repos.invoices.findById(id) as Invoice;
  }

  /**
   * Reserve the next attempt for an open invoice. Returns null if an attempt is already in flight
   * or unresolved (that one has to be settled or re-sent first). Must be called inside a transaction.
   */
  reserveAttempt(invoice: Invoice): ChargeAttempt | null {
    const attempts = this.repos.attempts.findByInvoice(invoice.id);
    if (attempts.some((a) => a.status === 'pending' || a.status === 'unknown')) return null;
    const attemptNo = attempts.length + 1;
    const id = this.ids.next('att');
    this.repos.attempts.insert({
      id,
      invoiceId: invoice.id,
      attemptNo,
      idempotencyKey: `${invoice.id}:attempt-${attemptNo}`,
      amountCents: invoice.amountCents,
      createdAt: this.clock.now(),
    });
    return this.repos.attempts.findById(id) as ChargeAttempt;
  }

  /** Call the provider for a reserved attempt and apply whatever comes back. */
  async send(attempt: ChargeAttempt, source: ChangeSource): Promise<void> {
    const invoice = this.repos.invoices.findById(attempt.invoiceId) as Invoice;
    const sub = this.repos.subscriptions.findById(invoice.subscriptionId) as Subscription;

    let result;
    try {
      result = await this.gateway.charge({
        customerId: sub.customerId,
        paymentMethodId: sub.paymentMethodId,
        amountCents: attempt.amountCents,
        currency: invoice.currency,
        idempotencyKey: attempt.idempotencyKey,
        invoiceId: invoice.id,
      });
    } catch (error) {
      // Timeout or transport failure: we don't know if money moved. Leave the attempt unresolved;
      // a webhook or the next billing run (re-sending the *same* key) will settle it.
      const now = this.clock.now();
      this.db.transaction(() => {
        this.repos.attempts.markUnknown(attempt.id);
        this.repos.audit.append({
          subscriptionId: sub.id,
          action: error instanceof GatewayTimeoutError ? 'charge_timed_out' : 'charge_errored',
          source,
          reference: attempt.id,
          at: now,
        });
      });
      return;
    }

    const now = this.clock.now();
    try {
      this.db.transaction(() => {
        // Re-read: a webhook may have settled this attempt while we were waiting on the provider.
        const freshSub = this.repos.subscriptions.findById(sub.id) as Subscription;
        const freshInvoice = this.repos.invoices.findById(invoice.id) as Invoice;
        const outcome = {
          subscription: freshSub,
          invoice: freshInvoice,
          result: result.outcome,
          providerChargeId: result.providerChargeId,
          failureReason: result.outcome === 'declined' ? result.reason : null,
          attempt,
          source,
          reference: attempt.id,
          at: now,
        };
        const applied = this.outcomes.apply(outcome);
        if (!applied.applied) this.outcomes.recordUnappliedResult(outcome);
      });
    } catch (error) {
      // The provider answered but we failed to record it (partial failure). Nothing was written,
      // so mark the attempt unknown: the next billing run re-sends the same idempotency key and
      // the provider returns the original result instead of charging again.
      this.repos.attempts.markUnknown(attempt.id);
      throw error;
    }
  }

  /**
   * The scheduled job: trial ends, renewals, retries, and re-sending charges whose outcome is unknown.
   * In production this would run on a timer; tests call it after moving the clock.
   */
  async runDue(): Promise<BillingRunSummary> {
    const now = this.clock.now();
    const summary: BillingRunSummary = { invoicesOpened: 0, chargesSent: 0, resends: 0, recordingFailures: 0 };

    const toSend = this.db.transaction(() => {
      const reserved: ChargeAttempt[] = [];

      for (const sub of this.repos.subscriptions.findByStatus('trialing')) {
        if (!sub.trialEndsAt || !isAtOrBefore(sub.trialEndsAt, now)) continue;
        if (this.repos.invoices.findBySubscription(sub.id).length > 0) continue;
        const invoice = this.openInvoice(sub, sub.trialEndsAt, 'billing');
        summary.invoicesOpened++;
        const attempt = this.reserveAttempt(invoice);
        if (attempt) reserved.push(attempt);
      }

      for (const sub of this.repos.subscriptions.findByStatus('active')) {
        if (!isAtOrBefore(sub.currentPeriodEnd, now)) continue;
        if (this.repos.invoices.findOpenForSubscription(sub.id)) continue;
        const invoice = this.openInvoice(sub, sub.currentPeriodEnd, 'billing');
        summary.invoicesOpened++;
        const attempt = this.reserveAttempt(invoice);
        if (attempt) reserved.push(attempt);
      }

      for (const invoice of this.repos.invoices.findDueForRetry(now)) {
        const sub = this.repos.subscriptions.findById(invoice.subscriptionId);
        if (sub?.status !== 'past_due') continue;
        const attempt = this.reserveAttempt(invoice);
        if (attempt) reserved.push(attempt);
      }

      for (const attempt of this.repos.attempts.findUnresolved()) {
        // Only chase an unknown charge while its invoice is still collectable. Once the invoice is
        // void (customer canceled) we stop billing; reconciling that charge is a manual/refund task.
        if (this.repos.invoices.findById(attempt.invoiceId)?.status !== 'open') continue;
        if (this.repos.attempts.claimForResend(attempt.id)) {
          reserved.push(attempt);
          summary.resends++;
        }
      }
      return reserved;
    });

    summary.chargesSent = toSend.length;
    for (const attempt of toSend) {
      try {
        await this.send(attempt, 'billing');
      } catch {
        // One broken charge must not stop the rest of the run; the attempt was left unknown
        // and will be re-sent next run.
        summary.recordingFailures++;
      }
    }
    return summary;
  }
}
