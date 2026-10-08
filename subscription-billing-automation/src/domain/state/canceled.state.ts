import { InvalidTransitionError, SubscriptionState } from './subscription-state.interface';

export class CanceledState implements SubscriptionState {
  readonly status = 'canceled' as const;

  paymentSucceeded(): SubscriptionState {
    throw new InvalidTransitionError(this.status, 'payment succeeded');
  }

  paymentFailed(_retriesExhausted: boolean): SubscriptionState {
    throw new InvalidTransitionError(this.status, 'payment failed');
  }

  cancel(): SubscriptionState {
    throw new InvalidTransitionError(this.status, 'cancel');
  }
}
