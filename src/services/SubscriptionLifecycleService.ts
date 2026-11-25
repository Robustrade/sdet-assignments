import { Subscription } from "../domain/Subscription";
import { SubscriptionStatus } from "../domain/SubscriptionStatus";
import { SubscriptionStateMachine } from "../state-machine/SubscriptionStateMachine";

export class SubscriptionLifecycleService {

  private stateMachine =
    new SubscriptionStateMachine();

  transition(
    subscription: Subscription,
    targetState: SubscriptionStatus
  ): void {

    const allowed =
      this.stateMachine.canTransition(
        subscription.status,
        targetState
      );

    if (!allowed) {
      throw new Error(
        "Invalid lifecycle transition"
      );
    }

    subscription.status =
      targetState;
  }
}