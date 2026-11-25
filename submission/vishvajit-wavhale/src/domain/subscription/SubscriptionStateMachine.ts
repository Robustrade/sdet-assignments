
import type {
  SubscriptionStatus,
  SubscriptionEvent
} from './SubscriptionStatus.js';

export class InvalidSubscriptionTransitionError extends Error {
  constructor(
    currentState: SubscriptionStatus,
    event: SubscriptionEvent
  ) {
    super(
      `Event ${event} is not allowed from state ${currentState}`
    );

    this.name = 'InvalidSubscriptionTransitionError';
  }
}

const transitions: Record<
  SubscriptionStatus,
  Partial<Record<SubscriptionEvent, SubscriptionStatus>>
> = {
  trialing: {
    PAYMENT_SUCCEEDED: 'active',
    PAYMENT_FAILED: 'past_due',
    CUSTOMER_CANCELED: 'canceled'
  },

  active: {
    PAYMENT_FAILED: 'past_due',
    CUSTOMER_CANCELED: 'canceled'
  },

  past_due: {
    RETRY_SUCCEEDED: 'active',
    RETRIES_EXHAUSTED: 'canceled',
    CUSTOMER_CANCELED: 'canceled'
  },

  canceled: {}
};

export class SubscriptionStateMachine {
  transition(
    currentState: SubscriptionStatus,
    event: SubscriptionEvent
  ): SubscriptionStatus {
    const nextState = transitions[currentState][event];

    if (!nextState) {
      throw new InvalidSubscriptionTransitionError(
        currentState,
        event
      );
    }

    return nextState;
  }

  canTransition(
    currentState: SubscriptionStatus,
    event: SubscriptionEvent
  ): boolean {
    return transitions[currentState][event] !== undefined;
  }
}
