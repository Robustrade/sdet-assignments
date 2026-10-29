import type { InvoiceRecord } from './Invoice';
import type { SubscriptionRecord } from './Subscription';

/** An active subscription is charged again this long after its last payment. */
export const BILLING_PERIOD_DAYS = 30;

/** A past_due subscription is retried this long after its last failed attempt. */
export const RETRY_INTERVAL_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export type BillingDecision =
  | { readonly action: 'none' }
  /** Create the invoice for this attempt number, then charge it. */
  | { readonly action: 'charge_new'; readonly attempt: number }
  /** An earlier charge got no answer (timeout): send the same invoice, same idempotency key, again. */
  | { readonly action: 'resume_pending'; readonly invoice: InvoiceRecord };

const NONE: BillingDecision = { action: 'none' };

const elapsed = (since: string, now: Date, days: number): boolean =>
  now.getTime() >= new Date(since).getTime() + days * DAY_MS;

/**
 * What must the billing run do for this subscription right now? A pure function of the stored rows
 * and the clock, so every timing rule can be tested without a service, a provider or a repository.
 *
 * - `canceled`: never anything.
 * - `trialing`: nothing until `trialEndsAt`; then the first charge (attempt 1).
 * - `active`: a new charge 30 days after the latest payment (a refunded invoice was a payment).
 * - `past_due`: a new charge 1 day after the latest failure.
 * - A `pending` latest invoice (a charge whose outcome is unknown) is resumed, not duplicated; for a
 *   trialing subscription only once its trial has ended.
 *
 * `invoicesByAttempt` must be ordered by attempt, oldest first.
 */
export function decideBilling(
  subscription: SubscriptionRecord,
  invoicesByAttempt: readonly InvoiceRecord[],
  now: Date,
): BillingDecision {
  const latest = invoicesByAttempt[invoicesByAttempt.length - 1];
  const nextAttempt = (latest?.attempt ?? 0) + 1;

  switch (subscription.status) {
    case 'canceled':
      return NONE;

    case 'trialing':
      if (!elapsed(subscription.trialEndsAt, now, 0)) {
        return NONE;
      }
      if (latest === undefined) {
        return { action: 'charge_new', attempt: nextAttempt };
      }
      return latest.status === 'pending' ? { action: 'resume_pending', invoice: latest } : NONE;

    case 'active':
      if (latest === undefined) {
        return NONE;
      }
      if (latest.status === 'pending') {
        return { action: 'resume_pending', invoice: latest };
      }
      return (latest.status === 'paid' || latest.status === 'refunded') &&
        elapsed(latest.createdAt, now, BILLING_PERIOD_DAYS)
        ? { action: 'charge_new', attempt: nextAttempt }
        : NONE;

    case 'past_due':
      if (latest === undefined) {
        return NONE;
      }
      if (latest.status === 'pending') {
        return { action: 'resume_pending', invoice: latest };
      }
      return latest.status === 'failed' && elapsed(latest.updatedAt, now, RETRY_INTERVAL_DAYS)
        ? { action: 'charge_new', attempt: nextAttempt }
        : NONE;
  }
}
