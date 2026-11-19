import { Clock } from '../clock';
import { canPaymentTransition } from '../domain/payment-state-machine';
import { AuditTrigger, Payment } from '../domain/types';
import { Repositories } from '../repositories';
import { Lifecycle } from './lifecycle';

export type PaymentOutcome =
  | { type: 'succeeded'; providerReference?: string }
  | { type: 'failed'; providerReference?: string; failureCode?: string }
  | { type: 'timed_out'; providerReference?: string; failureCode?: string }
  | { type: 'refunded' };

export type ApplyResult = { applied: true } | { applied: false; reason: string };

/**
 * Applies ONE payment outcome to ONE payment attempt - whether the outcome came
 * from the provider's synchronous answer or from a webhook. Using one code path
 * for both is what keeps "sync result + webhook for the same charge" and
 * "success followed by failure" consistent.
 *
 * Rules (design §9-§10):
 *  - canceled subscriptions are terminal: nothing is changed;
 *  - a final payment status is never overwritten (payment transition table);
 *  - an invoice that is already paid cannot be paid or failed again;
 *  - the subscription only moves through the Lifecycle (transition table).
 *
 * Must run inside a transaction; returns `applied: false` + reason when the
 * outcome is stale/inapplicable, and in that case writes nothing.
 */
export class PaymentOutcomeApplier {
  constructor(
    private readonly repos: Repositories,
    private readonly lifecycle: Lifecycle,
    private readonly clock: Clock,
    private readonly maxAttemptsPerInvoice: number,
  ) {}

  apply(payment: Payment, outcome: PaymentOutcome, source: { trigger: AuditTrigger; referenceId: string }): ApplyResult {
    const subscription = this.repos.subscriptions.findById(payment.subscriptionId);
    const invoice = this.repos.invoices.findById(payment.invoiceId);
    if (!subscription || !invoice) throw new Error(`Orphan payment ${payment.id}`);
    if (subscription.status === 'canceled') return ignored('subscription_canceled');

    const now = this.clock.now().toISOString();
    const audit = { trigger: source.trigger, referenceId: source.referenceId };

    switch (outcome.type) {
      case 'succeeded': {
        if (invoice.status !== 'open') return ignored(invoice.status === 'void' ? 'invoice_void' : 'invoice_already_paid');
        if (!canPaymentTransition(payment.status, 'succeeded')) return ignored('stale_payment_event');
        this.repos.payments.update({
          ...payment,
          status: 'succeeded',
          providerReference: outcome.providerReference ?? payment.providerReference,
          failureCode: null, // clear any code left by an earlier timeout on this attempt
          updatedAt: now,
        });
        this.repos.invoices.updateStatus(invoice.id, 'paid', now);
        if (subscription.status === 'active') {
          // Recurring renewal: no state change, just extend the paid-up period.
          this.repos.subscriptions.update({ ...subscription, currentPeriodEnd: invoice.periodEnd, updatedAt: now });
        } else {
          this.lifecycle.apply(subscription, 'charge_succeeded', audit, { currentPeriodEnd: invoice.periodEnd });
        }
        return { applied: true };
      }

      case 'failed': {
        if (invoice.status !== 'open') return ignored(invoice.status === 'void' ? 'invoice_void' : 'invoice_already_paid');
        if (!canPaymentTransition(payment.status, 'failed')) return ignored('stale_payment_event');
        this.repos.payments.update({
          ...payment,
          status: 'failed',
          providerReference: outcome.providerReference ?? payment.providerReference,
          failureCode: outcome.failureCode ?? null,
          updatedAt: now,
        });
        let current = subscription;
        if (this.lifecycle.canApply(current, 'charge_failed')) {
          current = this.lifecycle.apply(current, 'charge_failed', audit); // trialing/active -> past_due
        }
        if (payment.attemptNumber >= this.maxAttemptsPerInvoice && this.lifecycle.canApply(current, 'retries_exhausted')) {
          this.repos.invoices.updateStatus(invoice.id, 'void', now);
          this.lifecycle.apply(current, 'retries_exhausted', { trigger: 'retries_exhausted', referenceId: payment.id }, {
            canceledAt: now,
          });
        }
        return { applied: true };
      }

      case 'timed_out': {
        if (!canPaymentTransition(payment.status, 'timed_out')) return ignored('stale_payment_event');
        // Unknown outcome: record it, change nothing else, never auto re-charge.
        this.repos.payments.update({
          ...payment,
          status: 'timed_out',
          providerReference: outcome.providerReference ?? payment.providerReference,
          failureCode: outcome.failureCode ?? 'provider_timeout',
          updatedAt: now,
        });
        return { applied: true };
      }

      case 'refunded': {
        if (!canPaymentTransition(payment.status, 'refunded')) return ignored('payment_not_refundable');
        this.repos.payments.update({ ...payment, status: 'refunded', updatedAt: now });
        this.repos.invoices.updateStatus(invoice.id, 'refunded', now);
        // Assumption A-08: the assignment defines no lifecycle transition for refunds.
        return { applied: true };
      }
    }
  }
}

function ignored(reason: string): ApplyResult {
  return { applied: false, reason };
}
