import { ActiveState } from './active.state';
import { SubscriptionState } from './subscription-state.interface';
import { CanceledState } from './canceled.state';
import { PastDueState } from './past-due.state';

export class TrialingState implements SubscriptionState {
  readonly status = 'trialing' as const;

  paymentSucceeded(): SubscriptionState {
    return new ActiveState();
  }

  paymentFailed(_retriesExhausted: boolean): SubscriptionState {
    return new PastDueState();
  }

  cancel(): SubscriptionState {
    return new CanceledState();
  }
}
