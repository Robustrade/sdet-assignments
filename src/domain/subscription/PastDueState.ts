import { SubscriptionState } from "./SubscriptionState";
import { Subscription } from "./Subscription";
import { ActiveState } from "./ActiveState";
import { CanceledState } from "./CanceledState";


export class PastDueState implements SubscriptionState {


  name(): string {
    return "past_due";
  }


  paymentSucceeded(subscription: Subscription): void {

    subscription.changeState(
      new ActiveState()
    );

  }


  paymentFailed(subscription: Subscription): void {

    // remains past_due
  }


  cancel(subscription: Subscription): void {

    subscription.changeState(
      new CanceledState()
    );

  }

}