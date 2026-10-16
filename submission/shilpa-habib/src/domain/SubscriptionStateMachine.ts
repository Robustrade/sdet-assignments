import type { SubscriptionStatus } from "./Subscription";

export type SubscriptionTrigger =
  | "payment_succeeded"
  | "payment_failed"
  | "retries_exhausted"
  | "customer_canceled";

const TRANSITIONS: Record<
  SubscriptionStatus,
  Partial<Record<SubscriptionTrigger, SubscriptionStatus>>
> = {
  trialing: {
    payment_succeeded: "active",
    payment_failed: "past_due",
    customer_canceled: "canceled",
  },
  active: {
    payment_failed: "past_due",
    customer_canceled: "canceled",
  },
  past_due: {
    payment_succeeded: "active",
    retries_exhausted: "canceled",
  },
  canceled: {},
};

export class InvalidSubscriptionTransitionError extends Error {
  constructor(
    public readonly currentStatus: SubscriptionStatus,
    public readonly trigger: SubscriptionTrigger,
  ) {
    super(`Trigger '${trigger}' is not allowed from status '${currentStatus}'`);
    this.name = "InvalidSubscriptionTransitionError";
  }
}

export class SubscriptionStateMachine {
  transition(
    currentStatus: SubscriptionStatus,
    trigger: SubscriptionTrigger,
  ): SubscriptionStatus {
    const nextStatus = TRANSITIONS[currentStatus][trigger];

    if (!nextStatus) {
      throw new InvalidSubscriptionTransitionError(currentStatus, trigger);
    }

    return nextStatus;
  }

  canTransition(
    currentStatus: SubscriptionStatus,
    trigger: SubscriptionTrigger,
  ): boolean {
    return TRANSITIONS[currentStatus][trigger] !== undefined;
  }
}
