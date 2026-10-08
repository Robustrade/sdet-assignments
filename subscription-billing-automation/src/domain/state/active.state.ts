import { CanceledState } from './canceled.state';
import { PastDueState } from './past-due.state';
import { SubscriptionState } from './subscription-state.interface';

export class ActiveState implements SubscriptionState {
  readonly status = 'active' as const;

  paymentSucceeded(): SubscriptionState {
    return this;
  }

  paymentFailed(_retriesExhausted: boolean): SubscriptionState {
    return new PastDueState();
  }

  cancel(): SubscriptionState {
    return new CanceledState();
  }
}
