/**
 * Active State
 *
 * Subscription is active and in good standing.
 * Valid transitions:
 * - onPaymentFailure() -> PastDueState (recurring charge fails)
 * - onCancel() -> CanceledState (customer/API cancels)
 */

import { SubscriptionState } from './SubscriptionState';
import { PastDueState } from './PastDueState';
import { CanceledState } from './CanceledState';

export class ActiveState implements SubscriptionState {
  readonly status = 'active' as const;

  onPaymentSuccess(): SubscriptionState {
    // Already active, successful payment keeps it active
    return this;
  }

  onPaymentFailure(): SubscriptionState {
    // Recurring charge fails, move to past_due
    return new PastDueState();
  }

  onCancel(): SubscriptionState {
    // Customer or API cancels the subscription
    return new CanceledState();
  }

  onRetriesExhausted(): SubscriptionState {
    // Not applicable in active state - return self
    return this;
  }

  isTerminal(): boolean {
    return false;
  }
}
