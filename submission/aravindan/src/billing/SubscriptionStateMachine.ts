class SubscriptionStateMachine {
  transitions: { trialing: { payment_succeeded: string; payment_failed: string; customer_canceled: string; }; active: { payment_failed: string; customer_canceled: string; }; past_due: { payment_succeeded: string; retries_exhausted: string; }; canceled: {}; };
  constructor() {
    this.transitions = {
      trialing: {
        payment_succeeded: 'active',
        payment_failed: 'past_due',
        customer_canceled: 'canceled',
      },
      active: {
        payment_failed: 'past_due',
        customer_canceled: 'canceled',
      },
      past_due: {
        payment_succeeded: 'active',
        retries_exhausted: 'canceled',
      },
      canceled: {},
    };
  }

  canTransition(currentState: keyof SubscriptionStateMachine['transitions'], trigger: string) {
    return Boolean((this.transitions[currentState] as Record<string, string> | undefined)?.[trigger]);
  }

  apply(currentState: keyof SubscriptionStateMachine['transitions'], trigger: string) {
    const nextState = (this.transitions[currentState] as Record<string, string> | undefined)?.[trigger];
    if (!nextState) {
      throw new Error(`Illegal transition from ${currentState} on ${trigger}`);
    }
    return nextState;
  }
}

module.exports = { SubscriptionStateMachine };

export {};
