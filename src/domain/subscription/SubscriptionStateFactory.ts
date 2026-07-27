import { SubscriptionState } from "./SubscriptionState";
import { TrialingState } from "./TrialingState";
import { ActiveState } from "./ActiveState";
import { PastDueState } from "./PastDueState";
import { CanceledState } from "./CanceledState";


export class SubscriptionStateFactory {


    static create(
        status: string
    ): SubscriptionState {


        switch(status) {


            case "trialing":

                return new TrialingState();



            case "active":

                return new ActiveState();



            case "past_due":

                return new PastDueState();



            case "canceled":

                return new CanceledState();



            default:

                return new TrialingState();

        }

    }

}