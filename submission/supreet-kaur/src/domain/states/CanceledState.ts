import { SubscriptionContext, SubscriptionState } from "./State";

/**
 * Terminal state. This class contains NO transitionTo(...) calls at all -- that is the whole
 * point. It is not "canceled, but check a flag before reactivating"; there is no code path in
 * this file that can move a subscription out of `canceled`. That is what makes
 * "canceled -> active via a stray webhook" structurally impossible rather than merely
 * validated-against.
 */
class CanceledStateImpl implements SubscriptionState {
  readonly status = "canceled" as const;

  onPaymentSucceeded(ctx: SubscriptionContext): void {
    ctx.recordIgnoredEvent("payment.succeeded webhook for a canceled subscription ignored");
  }

  onPaymentFailed(ctx: SubscriptionContext): void {
    ctx.recordIgnoredEvent("payment.failed webhook for a canceled subscription ignored");
  }

  onPaymentRefunded(ctx: SubscriptionContext): void {
    ctx.recordIgnoredEvent("payment.refunded webhook for a canceled subscription ignored");
  }

  onCancel(ctx: SubscriptionContext): void {
    ctx.recordIgnoredEvent("cancel requested for an already-canceled subscription");
  }
}

export const CanceledState: SubscriptionState = new CanceledStateImpl();
