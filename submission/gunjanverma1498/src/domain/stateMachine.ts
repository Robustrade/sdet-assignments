import type { LifecycleEvent, SubscriptionStatus } from './types';

/**
 * Subscription lifecycle state machine (explicit transition-table pattern).
 *
 * This is the single authority on how a subscription's status may change. No
 * other code mutates `status` directly — the service always asks this machine
 * what the next status is. That makes illegal transitions structurally hard to
 * reach: if a (state, event) pair is not in the table, the event is a no-op,
 * never a silent, ad-hoc mutation.
 *
 * Lifecycle (from the assignment):
 *   trialing --charge succeeds--> active
 *   trialing --charge fails------> past_due
 *   active   --charge fails------> past_due
 *   past_due --charge succeeds---> active
 *   past_due --retries exhausted-> canceled
 *   active   --cancel------------> canceled
 *   trialing --cancel------------> canceled
 *
 * Deliberate, documented extensions beyond the diagram:
 *   - active   + CHARGE_SUCCEEDED -> active (recurring charge; no regression)
 *   - past_due + CHARGE_FAILED    -> past_due until retries are exhausted
 *   - past_due + CANCEL           -> canceled (a dunning subscription can be cancelled)
 *   - REFUND is recorded but never changes lifecycle state.
 * `canceled` is terminal: every event is ignored.
 */

export interface TransitionContext {
  failedChargeCount: number;
  maxRetries: number;
}

export interface TransitionResult {
  fromStatus: SubscriptionStatus;
  toStatus: SubscriptionStatus;
  /** True when the status actually changed. */
  changed: boolean;
  /**
   * True when the event was a meaningful signal for this state (e.g. a recurring
   * success on an active subscription is recognized but not a status change).
   * False means the event was ignored as a stray (e.g. any event on `canceled`).
   */
  recognized: boolean;
  reason: string;
}

export class SubscriptionStateMachine {
  /**
   * Compute the outcome of applying `event` to a subscription currently in
   * `fromStatus`. Pure function of its inputs — it reads nothing and writes
   * nothing, which makes it trivial to unit test exhaustively.
   */
  apply(
    fromStatus: SubscriptionStatus,
    event: LifecycleEvent,
    context: TransitionContext,
  ): TransitionResult {
    const stay = (recognized: boolean, reason: string): TransitionResult => ({
      fromStatus,
      toStatus: fromStatus,
      changed: false,
      recognized,
      reason,
    });
    const move = (toStatus: SubscriptionStatus, reason: string): TransitionResult => ({
      fromStatus,
      toStatus,
      changed: toStatus !== fromStatus,
      recognized: true,
      reason,
    });

    // `canceled` is terminal: irreversible via any further event.
    if (fromStatus === 'canceled') {
      return stay(false, 'subscription is canceled; event ignored');
    }

    switch (event) {
      case 'CANCEL':
        return move('canceled', 'cancelled via API');

      case 'CHARGE_SUCCEEDED':
        if (fromStatus === 'trialing') return move('active', 'trial charge succeeded');
        if (fromStatus === 'past_due') return move('active', 'retry charge succeeded');
        // active
        return stay(true, 'recurring charge succeeded; already active');

      case 'CHARGE_FAILED':
        if (fromStatus === 'trialing') return move('past_due', 'first charge failed');
        if (fromStatus === 'active') return move('past_due', 'recurring charge failed');
        // past_due: accumulate retries, cancel once exhausted.
        if (context.failedChargeCount + 1 >= context.maxRetries) {
          return move('canceled', 'retries exhausted');
        }
        return stay(true, 'charge failed again; still past_due');

      case 'REFUND':
        // Refunds are recorded on the invoice but do not move the lifecycle.
        return stay(true, 'refund recorded; no state change');

      default: {
        const exhaustive: never = event;
        return stay(false, `unhandled event ${String(exhaustive)}`);
      }
    }
  }
}
