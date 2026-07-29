import {SubscriptionState} from "./SubscriptionState";
import {Subscription} from "./Subscription";
import {ActiveState} from "./ActiveState";
import {PastDueState} from "./PastDueState";
import {CanceledState} from "./CanceledState";


export class TrialingState implements SubscriptionState {


name(){
    return "trialing";
}


paymentSucceeded(
 subscription:Subscription
){

 subscription.changeState(
    new ActiveState()
 );

}


paymentFailed(
 subscription:Subscription
){

 subscription.changeState(
    new PastDueState()
 );

}


cancel(
 subscription:Subscription
){

 subscription.changeState(
    new CanceledState()
 );

}

}