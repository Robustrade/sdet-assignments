export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface SubscriptionState {
  readonly status: SubscriptionStatus;
  paymentSucceeded(): SubscriptionState;
  paymentFailed(retriesExhausted: boolean): SubscriptionState;
  cancel(): SubscriptionState;
}

export class InvalidTransitionError extends Error {
  constructor(from: SubscriptionStatus, event: string) {
    super(`Cannot apply "${event}" while subscription is "${from}"`);
    this.name = 'InvalidTransitionError';
  }
}
