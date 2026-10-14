export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export class SubscriptionStateMachine {
  private readonly transitions: Record<
    SubscriptionStatus,
    SubscriptionStatus[]
  > = {
    trialing: ["active", "past_due", "canceled"],
    active: ["past_due", "canceled"],
    past_due: ["active", "canceled"],
    canceled: [],
  };

  canTransition(
    current: SubscriptionStatus,
    next: SubscriptionStatus
  ): boolean {
    return this.transitions[current].includes(next);
  }

  transition(
    current: SubscriptionStatus,
    next: SubscriptionStatus
  ): SubscriptionStatus {
    if (!this.canTransition(current, next)) {
      throw new Error(
        `Invalid subscription transition: ${current} -> ${next}`
      );
    }

    return next;
  }
}
