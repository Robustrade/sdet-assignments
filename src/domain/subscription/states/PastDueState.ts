/**
 * Past Due State
 *
 * Subscription has failed payment and is awaiting retry.
 * Valid transitions:
 * - onPaymentSuccess() -> ActiveState (retry charge succeeds)
 * - onRetriesExhausted() -> CanceledState (all retries failed)
 * - onCancel() -> CanceledState (customer/API cancels)
 */

import { SubscriptionState } from './SubscriptionState';
import { ActiveState } from './ActiveState';
import { CanceledState } from './CanceledState';

export class PastDueState implements SubscriptionState {
  readonly status = 'past_due' as const;

  onPaymentSuccess(): SubscriptionState {
    // Retry charge succeeds, reactivate subscription
    return new ActiveState();
  }

  onPaymentFailure(): SubscriptionState {
    // Another failed retry, stay in past_due
    return this;
  }

  onCancel(): SubscriptionState {
    // Customer or API cancels while past due
    return new CanceledState();
  }

  onRetriesExhausted(): SubscriptionState {
    // All retry attempts failed, cancel subscription
    return new CanceledState();
  }

  isTerminal(): boolean {
    return false;
  }
}
