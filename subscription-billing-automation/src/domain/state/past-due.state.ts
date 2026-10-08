import { ActiveState } from './active.state';
import { CanceledState } from './canceled.state';
import { InvalidTransitionError, SubscriptionState } from './subscription-state.interface';

export class PastDueState implements SubscriptionState {
  readonly status = 'past_due' as const;

  paymentSucceeded(): SubscriptionState {
    return new ActiveState();
  }

  paymentFailed(retriesExhausted: boolean): SubscriptionState {
    return retriesExhausted ? new CanceledState() : this;
  }

  cancel(): SubscriptionState {
    throw new InvalidTransitionError(this.status, 'cancel');
  }
}
