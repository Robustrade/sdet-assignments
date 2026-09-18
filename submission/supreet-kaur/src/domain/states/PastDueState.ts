import { SubscriptionContext, SubscriptionState } from "./State";
import { ActiveState } from "./ActiveState";
import { CanceledState } from "./CanceledState";

/** After this many consecutive failed retry attempts while past_due, the subscription is canceled. */
export const MAX_RETRIES = 2;

class PastDueStateImpl implements SubscriptionState {
  readonly status = "past_due" as const;

  onPaymentSucceeded(ctx: SubscriptionContext): void {
    ctx.resetRetryCount();
    ctx.transitionTo(ActiveState, "retry charge succeeded");
  }

  onPaymentFailed(ctx: SubscriptionContext): void {
    ctx.incrementRetryCount();
    if (ctx.retryCount >= MAX_RETRIES) {
      ctx.transitionTo(CanceledState, `retries exhausted after ${ctx.retryCount} failed attempts`);
    } else {
      // Stays past_due; re-entering the same state via transitionTo would add a confusing
      // audit entry ("past_due -> past_due"), so we just record the failed attempt.
      ctx.recordIgnoredEvent(`retry attempt ${ctx.retryCount} failed, remaining past_due`);
    }
  }

  onPaymentRefunded(ctx: SubscriptionContext): void {
    ctx.recordIgnoredEvent("refund received while past_due (no successful charge to refund)");
  }

  onCancel(ctx: SubscriptionContext): void {
    ctx.transitionTo(CanceledState, "canceled by customer/API while past_due");
  }
}

export const PastDueState: SubscriptionState = new PastDueStateImpl();
