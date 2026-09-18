import { SubscriptionContext, SubscriptionState } from "./State";
import { PastDueState } from "./PastDueState";
import { CanceledState } from "./CanceledState";

class ActiveStateImpl implements SubscriptionState {
  readonly status = "active" as const;

  onPaymentSucceeded(ctx: SubscriptionContext): void {
    // A duplicate/redelivered success webhook for an already-active subscription. Idempotent
    // no-op: we do not re-transition into the same state via a fresh event (that would make
    // duplicate delivery observably different from single delivery).
    ctx.recordIgnoredEvent("duplicate success webhook while already active");
  }

  onPaymentFailed(ctx: SubscriptionContext): void {
    ctx.transitionTo(PastDueState, "recurring charge failed");
  }

  onPaymentRefunded(ctx: SubscriptionContext): void {
    // Modeling choice: a refund on an active subscription pushes it to past_due rather than
    // silently staying active with money returned. Documented in DESIGN.md as an assumption.
    ctx.transitionTo(PastDueState, "payment refunded while active");
  }

  onCancel(ctx: SubscriptionContext): void {
    ctx.transitionTo(CanceledState, "canceled by customer/API while active");
  }
}

export const ActiveState: SubscriptionState = new ActiveStateImpl();
