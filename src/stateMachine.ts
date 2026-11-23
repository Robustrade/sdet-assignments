import { SubscriptionStatus } from "./domain";

export type TransitionTrigger =
  | "trial_end_charge_success"
  | "trial_end_charge_failure"
  | "recurring_charge_failure"
  | "retry_charge_success"
  | "retries_exhausted"
  | "customer_cancel";

const transitions: Record<SubscriptionStatus, Partial<Record<TransitionTrigger, SubscriptionStatus>>> = {
  trialing: {
    trial_end_charge_success: "active",
    trial_end_charge_failure: "past_due",
    customer_cancel: "canceled"
  },
  active: {
    recurring_charge_failure: "past_due",
    customer_cancel: "canceled"
  },
  past_due: {
    retry_charge_success: "active",
    retries_exhausted: "canceled"
  },
  canceled: {}
};

export class SubscriptionStateMachine {
  constructor(private status: SubscriptionStatus) {}

  getStatus(): SubscriptionStatus {
    return this.status;
  }

  transition(trigger: TransitionTrigger): SubscriptionStatus | null {
    const next = transitions[this.status][trigger];
    if (!next) return null;
    this.status = next;
    return next;
  }
}
