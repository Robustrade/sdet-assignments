import { SubscriptionStatus } from "../domain/SubscriptionStatus";

export class SubscriptionStateMachine {

  private transitions: Record<
    SubscriptionStatus,
    SubscriptionStatus[]
  > = {

    [SubscriptionStatus.TRIALING]: [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELED
    ],

    [SubscriptionStatus.ACTIVE]: [
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELED
    ],

    [SubscriptionStatus.PAST_DUE]: [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.CANCELED
    ],

    [SubscriptionStatus.CANCELED]: []
  };

  canTransition(
    current: SubscriptionStatus,
    next: SubscriptionStatus
  ): boolean {

    return this.transitions[current].includes(next);

  }

}