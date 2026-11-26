export enum SubscriptionState {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
}

export enum LifecycleEvent {
  FIRST_CHARGE_SUCCEEDED = 'FIRST_CHARGE_SUCCEEDED',
  FIRST_CHARGE_FAILED = 'FIRST_CHARGE_FAILED',
  RECURRING_CHARGE_FAILED = 'RECURRING_CHARGE_FAILED',
  RETRY_CHARGE_SUCCEEDED = 'RETRY_CHARGE_SUCCEEDED',
  RETRIES_EXHAUSTED = 'RETRIES_EXHAUSTED',
  CANCEL = 'CANCEL',
}

export class InvalidTransitionError extends Error {
  constructor(from: SubscriptionState, event: LifecycleEvent) {
    super(`Illegal state transition: cannot apply '${event}' when status is '${from}'`);
  }
}

// Clean interface instead of Record<...> (no < or > brackets!)
interface StateTransitionRules {
  [state: string]: {
    [event: string]: SubscriptionState;
  };
}

export class SubscriptionStateMachine {
  readonly transitions: StateTransitionRules;

  constructor() {
    this.transitions = {
      [SubscriptionState.TRIALING]: {
        [LifecycleEvent.FIRST_CHARGE_SUCCEEDED]: SubscriptionState.ACTIVE,
        [LifecycleEvent.FIRST_CHARGE_FAILED]: SubscriptionState.PAST_DUE,
        [LifecycleEvent.CANCEL]: SubscriptionState.CANCELED,
      },
      [SubscriptionState.ACTIVE]: {
        [LifecycleEvent.RECURRING_CHARGE_FAILED]: SubscriptionState.PAST_DUE,
        [LifecycleEvent.CANCEL]: SubscriptionState.CANCELED,
      },
      [SubscriptionState.PAST_DUE]: {
        [LifecycleEvent.RETRY_CHARGE_SUCCEEDED]: SubscriptionState.ACTIVE,
        [LifecycleEvent.RETRIES_EXHAUSTED]: SubscriptionState.CANCELED,
      },
      [SubscriptionState.CANCELED]: {},
    };
  }

  transition(current: SubscriptionState, event: LifecycleEvent): SubscriptionState {
    const nextState = this.transitions[current]?.[event];
    if (!nextState) {
      throw new InvalidTransitionError(current, event);
    }
    return nextState;
  }
}
