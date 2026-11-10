/**
 * State Pattern - Base Interface
 *
 * This interface defines the contract for all subscription states.
 * Each concrete state class implements this interface and defines
 * which transitions are valid from that state.
 */

import { SubscriptionStatus } from '../types';

export interface SubscriptionState {
  status: SubscriptionStatus;

  /**
   * Handle successful payment event
   * @returns Next state after successful payment
   */
  onPaymentSuccess(): SubscriptionState;

  /**
   * Handle failed payment event
   * @returns Next state after payment failure
   */
  onPaymentFailure(): SubscriptionState;

  /**
   * Handle cancellation request (API or customer initiated)
   * @returns Next state after cancellation
   */
  onCancel(): SubscriptionState;

  /**
   * Handle retry exhaustion (multiple payment failures)
   * @returns Next state after retries exhausted
   */
  onRetriesExhausted(): SubscriptionState;

  /**
   * Check if this state allows transitions
   * @returns true if state is terminal (no further transitions)
   */
  isTerminal(): boolean;
}
