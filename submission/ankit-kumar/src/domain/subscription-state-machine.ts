export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type SubscriptionEvent =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "retries.exhausted"
  | "customer.cancelled";

type TransitionTable = {
  [Status in SubscriptionStatus]: Partial<
    Record<SubscriptionEvent, SubscriptionStatus>
  >;
};

const TRANSITIONS: TransitionTable = {
  trialing: {
    "payment.succeeded": "active",
    "payment.failed": "past_due",
    "customer.cancelled": "canceled"
  },
  active: {
    "payment.failed": "past_due",
    "customer.cancelled": "canceled"
  },
  past_due: {
    "payment.succeeded": "active",
    "retries.exhausted": "canceled"
  },
  canceled: {}
};

export class SubscriptionStateMachine {
  static transition(
    currentStatus: SubscriptionStatus,
    event: SubscriptionEvent
  ): SubscriptionStatus {
    const nextStatus = TRANSITIONS[currentStatus][event];

    if (!nextStatus) {
      throw new Error(
        `Invalid subscription transition: ${currentStatus} + ${event}`
      );
    }

    return nextStatus;
  }
}
