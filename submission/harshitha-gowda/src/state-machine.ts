export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type Trigger =
  | 'trial_charge_succeeded'
  | 'trial_charge_failed'
  | 'recurring_charge_failed'
  | 'retry_succeeded'
  | 'retries_exhausted'
  | 'cancel_requested';

export const ALL_STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'canceled'];
export const ALL_TRIGGERS: Trigger[] = [
  'trial_charge_succeeded',
  'trial_charge_failed',
  'recurring_charge_failed',
  'retry_succeeded',
  'retries_exhausted',
  'cancel_requested',
];

/** The single source of truth for the lifecycle. Anything not listed here is illegal. */
export const TRANSITION_TABLE: Record<SubscriptionStatus, Partial<Record<Trigger, SubscriptionStatus>>> = {
  trialing: {
    trial_charge_succeeded: 'active',
    trial_charge_failed: 'past_due',
    cancel_requested: 'canceled',
  },
  active: {
    recurring_charge_failed: 'past_due',
    cancel_requested: 'canceled',
  },
  past_due: {
    retry_succeeded: 'active',
    retries_exhausted: 'canceled',
  },
  canceled: {}, // terminal
};

export class IllegalTransitionError extends Error {
  constructor(public from: SubscriptionStatus, public trigger: Trigger) {
    super(`Illegal transition: ${from} --${trigger}--> ?`);
  }
}

export class SubscriptionStateMachine {
  static can(from: SubscriptionStatus, trigger: Trigger): boolean {
    return TRANSITION_TABLE[from][trigger] !== undefined;
  }

  static next(from: SubscriptionStatus, trigger: Trigger): SubscriptionStatus {
    const to = TRANSITION_TABLE[from][trigger];
    if (!to) throw new IllegalTransitionError(from, trigger);
    return to;
  }
}
