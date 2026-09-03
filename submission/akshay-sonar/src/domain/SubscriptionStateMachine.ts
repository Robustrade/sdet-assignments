import { SubscriptionStatus } from "./SubscriptionStatus";

export class SubscriptionStateMachine {
  private readonly transitions: Record<
    SubscriptionStatus,
    SubscriptionStatus[]
  > = {
    [SubscriptionStatus.TRIALING]: [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELED,
    ],

    [SubscriptionStatus.ACTIVE]: [
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELED,
    ],

    [SubscriptionStatus.PAST_DUE]: [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.CANCELED,
    ],

    [SubscriptionStatus.CANCELED]: [],
  };

  canTransition(
    currentState: SubscriptionStatus,
    nextState: SubscriptionStatus
  ): boolean {
    return this.transitions[currentState].includes(nextState);
  }

  transition(
    currentState: SubscriptionStatus,
    nextState: SubscriptionStatus
  ): SubscriptionStatus {
    if (!this.canTransition(currentState, nextState)) {
      throw new Error(
        `Invalid subscription transition: ${currentState} -> ${nextState}`
      );
    }

    return nextState;
  }
}