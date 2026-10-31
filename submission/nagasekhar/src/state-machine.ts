export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

const allowedTransitions: Record<
  SubscriptionStatus,
  readonly SubscriptionStatus[]
> = {
  trialing: ['active', 'past_due', 'canceled'],
  active: ['past_due', 'canceled'],
  past_due: ['active', 'canceled'],
  canceled: [],
};

export class SubscriptionStateMachine {
  canTransition(
    current: SubscriptionStatus,
    next: SubscriptionStatus,
  ): boolean {
    return allowedTransitions[current].includes(next);
  }

  transition(
    current: SubscriptionStatus,
    next: SubscriptionStatus,
  ): SubscriptionStatus {
    if (!this.canTransition(current, next)) {
      throw new Error(
        `Invalid subscription transition: ${current} -> ${next}`,
      );
    }

    return next;
  }
}
