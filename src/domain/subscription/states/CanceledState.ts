/**
 * Canceled State
 *
 * Terminal state - subscription is canceled and cannot transition.
 * All transition methods return self (stay canceled).
 *
 * This prevents invalid transitions like:
 * - canceled -> active (via late webhook)
 * - canceled -> past_due (via late webhook)
 */

import { SubscriptionState } from './SubscriptionState';

export class CanceledState implements SubscriptionState {
  readonly status = 'canceled' as const;

  onPaymentSuccess(): SubscriptionState {
    // INVALID: Cannot reactivate a canceled subscription
    // This prevents stray webhooks from resurrecting canceled subscriptions
    return this;
  }

  onPaymentFailure(): SubscriptionState {
    // INVALID: Already canceled, ignore failures
    return this;
  }

  onCancel(): SubscriptionState {
    // Already canceled, idempotent
    return this;
  }

  onRetriesExhausted(): SubscriptionState {
    // Already canceled
    return this;
  }

  isTerminal(): boolean {
    return true;
  }
}
