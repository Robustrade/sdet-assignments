import { SubscriptionState } from "./SubscriptionState";
import { Subscription } from "./Subscription";
import { PastDueState } from "./PastDueState";
import { CanceledState } from "./CanceledState";


export class ActiveState implements SubscriptionState {


    name(): string {

        return "active";

    }



    paymentSucceeded(
        subscription: Subscription
    ): void {

        // Subscription is already active.
        // No state transition required.

    }



    paymentFailed(
        subscription: Subscription
    ): void {

        /*
         * Active subscriptions can move to past_due
         * when a genuine payment failure occurs.
         *
         * Late/out-of-order webhook protection
         * should be handled in WebhookService
         * before calling this transition.
         */

        subscription.changeState(
            new PastDueState()
        );

    }



    cancel(
        subscription: Subscription
    ): void {


        subscription.changeState(
            new CanceledState()
        );

    }


}