/**
 * State pattern for the subscription lifecycle.
 *
 * Why: the assignment explicitly warns against "a status string mutated ad hoc from six
 * different call sites". Instead, `Subscription.currentState` holds one of the four
 * SubscriptionState singletons below. Every place that might change lifecycle state
 * (webhook success/failure/refund, cancel, retry) goes through `state.onX(context)`.
 * A state that doesn't support a given event simply ignores it (e.g. CanceledState ignores
 * every payment event) -- so "canceled -> active via stray webhook" is not just disallowed
 * by a check, it is *structurally impossible*: CanceledState has no code path that calls
 * transitionTo(ActiveState).
 *
 * SubscriptionContext is the minimal surface a state needs from Subscription. States never
 * reach into repositories or the payment provider -- that keeps the state machine pure and
 * trivially unit-testable in isolation from persistence/HTTP.
 */

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface SubscriptionContext {
  readonly id: string;
  readonly retryCount: number;
  transitionTo(next: SubscriptionState, reason: string): void;
  incrementRetryCount(): void;
  resetRetryCount(): void;
  recordIgnoredEvent(reason: string): void;
}

export interface SubscriptionState {
  readonly status: SubscriptionStatus;

  /** A payment (initial or recurring) succeeded for this subscription's pending invoice. */
  onPaymentSucceeded(ctx: SubscriptionContext): void;

  /** A payment (initial or recurring/retry) failed for this subscription's pending invoice. */
  onPaymentFailed(ctx: SubscriptionContext): void;

  /** A previously-succeeded payment was refunded. */
  onPaymentRefunded(ctx: SubscriptionContext): void;

  /** Customer or API requested cancellation. */
  onCancel(ctx: SubscriptionContext): void;
}
