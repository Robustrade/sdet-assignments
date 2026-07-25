const SubscriptionState = {
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
};

const TransitionTrigger = {
  TRIAL_CHARGE_SUCCEEDED: 'trial_charge_succeeded',
  TRIAL_CHARGE_FAILED: 'trial_charge_failed',
  RECURRING_CHARGE_FAILED: 'recurring_charge_failed',
  RETRY_CHARGE_SUCCEEDED: 'retry_charge_succeeded',
  RETRIES_EXHAUSTED: 'retries_exhausted',
  API_CANCEL: 'api_cancel',
};

const transitionTable = {
  [SubscriptionState.TRIALING]: {
    [TransitionTrigger.TRIAL_CHARGE_SUCCEEDED]: SubscriptionState.ACTIVE,
    [TransitionTrigger.TRIAL_CHARGE_FAILED]: SubscriptionState.PAST_DUE,
    [TransitionTrigger.API_CANCEL]: SubscriptionState.CANCELED,
  },
  [SubscriptionState.ACTIVE]: {
    [TransitionTrigger.RECURRING_CHARGE_FAILED]: SubscriptionState.PAST_DUE,
    [TransitionTrigger.API_CANCEL]: SubscriptionState.CANCELED,
  },
  [SubscriptionState.PAST_DUE]: {
    [TransitionTrigger.RETRY_CHARGE_SUCCEEDED]: SubscriptionState.ACTIVE,
    [TransitionTrigger.RETRIES_EXHAUSTED]: SubscriptionState.CANCELED,
  },
  [SubscriptionState.CANCELED]: {},
};

class SubscriptionStateMachine {
  static transition(fromState, trigger) {
    const next = transitionTable[fromState]
      ? transitionTable[fromState][trigger]
      : undefined;
    if (!next) {
      throw new Error(`INVALID_TRANSITION:${fromState}:${trigger}`);
    }
    return next;
  }

  static canTransition(fromState, trigger) {
    return Boolean(
      transitionTable[fromState] && transitionTable[fromState][trigger],
    );
  }
}

module.exports = {
  SubscriptionState,
  TransitionTrigger,
  SubscriptionStateMachine,
};
