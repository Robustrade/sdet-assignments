export type SubscriptionState =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export type SubscriptionEvent =
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'CANCEL'
  | 'RETRIES_EXHAUSTED';

const transitions: Record<
  SubscriptionState,
  Partial<Record<SubscriptionEvent, SubscriptionState>>
> = {
  trialing: {
    PAYMENT_SUCCEEDED: 'active',
    PAYMENT_FAILED: 'past_due',
    CANCEL: 'canceled',
  },

  active: {
    PAYMENT_FAILED: 'past_due',
    CANCEL: 'canceled',
  },

  past_due: {
    PAYMENT_SUCCEEDED: 'active',
    RETRIES_EXHAUSTED: 'canceled',
  },

  canceled: {},
};

export function transition(
  currentState: SubscriptionState,
  event: SubscriptionEvent,
): SubscriptionState {
  const nextState = transitions[currentState][event];

  if (!nextState) {
    throw new Error(
      `Invalid subscription transition: ${currentState} -> ${event}`,
    );
  }

  return nextState;
}