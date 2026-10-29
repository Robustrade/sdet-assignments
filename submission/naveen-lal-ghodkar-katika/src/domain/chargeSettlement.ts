import type { InvoiceRecord } from './Invoice';
import { retriesExhausted } from './retryPolicy';
import type { Subscription, TransitionResult } from './SubscriptionStateMachine';

/**
 * What a charge result does to the subscription. Webhooks and the billing run both settle invoices,
 * so the rule lives here once: neither can drift from the other (e.g. in how retries are counted).
 * Status still only changes through `Subscription.apply`; these helpers just choose the trigger.
 */

/**
 * A payment arrived. Moves trialing / past_due to active; an active subscription (recurring payment)
 * has no `charge_succeeded` arrow, so it only gets the paid invoice and no transition.
 */
export function settleSuccess(subscription: Subscription): TransitionResult | undefined {
  return subscription.can('charge_succeeded') ? subscription.apply('charge_succeeded') : undefined;
}

/**
 * A charge failed. `historyWithFailure` is the subscription's invoices (by attempt) with the newly
 * failed one already marked `failed`.
 * - trialing / active: becomes past_due.
 * - already past_due: another failed retry changes nothing until the retry limit of consecutive failed
 *   invoices is reached, which cancels the subscription.
 */
export function settleFailure(
  subscription: Subscription,
  historyWithFailure: readonly InvoiceRecord[],
): TransitionResult | undefined {
  if (subscription.can('charge_failed')) {
    return subscription.apply('charge_failed');
  }
  if (retriesExhausted(historyWithFailure) && subscription.can('retries_exhausted')) {
    return subscription.apply('retries_exhausted');
  }
  return undefined;
}
