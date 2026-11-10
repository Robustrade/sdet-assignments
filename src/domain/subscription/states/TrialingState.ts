/**
 * Trialing State
 *
 * Initial state for new subscriptions with a trial period.
 * Valid transitions:
 * - onPaymentSuccess() -> ActiveState (trial ends, first charge succeeds)
 * - onPaymentFailure() -> PastDueState (trial ends, first charge fails)
 * - onCancel() -> CanceledState (customer cancels during trial)
 */

import { SubscriptionState } from './SubscriptionState';
import { ActiveState } from './ActiveState';
import { PastDueState } from './PastDueState';
import { CanceledState } from './CanceledState';

export class TrialingState implements SubscriptionState {
  readonly status = 'trialing' as const;

  onPaymentSuccess(): SubscriptionState {
    // Trial ends successfully, subscription becomes active
    return new ActiveState();
  }

  onPaymentFailure(): SubscriptionState {
    // Trial ends but charge fails, subscription goes to past_due
    return new PastDueState();
  }

  onCancel(): SubscriptionState {
    // Customer cancels during trial period
    return new CanceledState();
  }

  onRetriesExhausted(): SubscriptionState {
    // Not applicable during trial - return self
    return this;
  }

  isTerminal(): boolean {
    return false;
  }
}
