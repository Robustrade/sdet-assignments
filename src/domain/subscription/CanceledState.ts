import { SubscriptionState } from "./SubscriptionState";
import { Subscription } from "./Subscription";


export class CanceledState implements SubscriptionState {


  name(): string {
    return "canceled";
  }


  paymentSucceeded(subscription: Subscription): void {

    // Invalid transition.
    // A canceled subscription cannot reactivate.

  }


  paymentFailed(subscription: Subscription): void {

    // Invalid transition.
    // Ignore.

  }


  cancel(subscription: Subscription): void {

    // Already canceled.

  }

}