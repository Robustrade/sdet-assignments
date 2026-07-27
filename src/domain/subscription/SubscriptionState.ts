export interface SubscriptionState {

  name(): string;

  paymentSucceeded(
    subscription: any
  ): void;


  paymentFailed(
    subscription: any
  ): void;


  cancel(
    subscription: any
  ): void;

}