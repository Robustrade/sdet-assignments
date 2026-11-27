
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export class SubscriptionStateMachine {
  private static transitions: Record<
    SubscriptionStatus,
    SubscriptionStatus[]
  > = {
    trialing: ['active', 'past_due', 'canceled'],
    active: ['past_due', 'canceled'],
    past_due: ['active', 'canceled'],
    canceled: [],
  };

  static canTransition(
    currentStatus: SubscriptionStatus,
    newStatus: SubscriptionStatus
  ): boolean {
    return this.transitions[currentStatus].includes(newStatus);
  }

  static transition(
    currentStatus: SubscriptionStatus,
    newStatus: SubscriptionStatus
  ): SubscriptionStatus {
    if (!this.canTransition(currentStatus, newStatus)) {
      throw new Error(
        `Invalid subscription transition: ${currentStatus} -> ${newStatus}`
      );
    }

    return newStatus;
  }
}
