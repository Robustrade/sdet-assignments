import { SubscriptionContext, SubscriptionState } from "./State";
import { ActiveState } from "./ActiveState";
import { PastDueState } from "./PastDueState";
import { CanceledState } from "./CanceledState";

class TrialingStateImpl implements SubscriptionState {
  readonly status = "trialing" as const;

  onPaymentSucceeded(ctx: SubscriptionContext): void {
    ctx.resetRetryCount();
    ctx.transitionTo(ActiveState, "first charge succeeded");
  }

  onPaymentFailed(ctx: SubscriptionContext): void {
    ctx.transitionTo(PastDueState, "first charge failed");
  }

  onPaymentRefunded(ctx: SubscriptionContext): void {
    // A refund cannot legally arrive before a successful charge did. There is nothing valid
    // to refund yet, so we ignore it rather than inventing a transition for an event the
    // lifecycle diagram never describes.
    ctx.recordIgnoredEvent("refund received while still trialing (no prior successful charge)");
  }

  onCancel(ctx: SubscriptionContext): void {
    ctx.transitionTo(CanceledState, "canceled during trial");
  }
}

export const TrialingState: SubscriptionState = new TrialingStateImpl();
