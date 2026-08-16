import { SubscriptionStatus } from "./types";

export type SubscriptionEvent =
  | "first_charge_succeeded"
  | "first_charge_failed"
  | "recurring_charge_failed"
  | "retry_succeeded"
  | "retries_exhausted"
  | "customer_canceled";

const transitions: Record<
  SubscriptionStatus,
  Partial<Record<SubscriptionEvent, SubscriptionStatus>>
> = {
  trialing: {
    first_charge_succeeded: "active",
    first_charge_failed: "past_due",
    customer_canceled: "canceled",
  },

  active: {
    recurring_charge_failed: "past_due",
    customer_canceled: "canceled",
  },

  past_due: {
    retry_succeeded: "active",
    retries_exhausted: "canceled",
  },

  canceled: {},
};

export class SubscriptionStateMachine {
  transition(
    current: SubscriptionStatus,
    event: SubscriptionEvent,
  ): SubscriptionStatus {
    const nextState = transitions[current][event];

    if (!nextState) {
      throw new Error(`Invalid subscription transition: ${current} + ${event}`);
    }

    return nextState;
  }
}
