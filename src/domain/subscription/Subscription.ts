import { SubscriptionState } from "./SubscriptionState";


export class Subscription {

  private state: SubscriptionState;


  constructor(
    public readonly id:string,
    public readonly customerId:string,
    public readonly plan:string,
    initialState:SubscriptionState
  ){
    this.state = initialState;
  }


  getStatus():string {
    return this.state.name();
  }


  changeState(
    state:SubscriptionState
  ){
    this.state = state;
  }


  paymentSucceeded(){

    this.state.paymentSucceeded(this);

  }


  paymentFailed(){

    this.state.paymentFailed(this);

  }


  cancel(){

    this.state.cancel(this);

  }

}