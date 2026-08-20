import { SubscriptionStatus } from './types';

/**
 * All events that can drive a lifecycle transition, whether they originate
 * from a direct API call or an inbound webhook.
 */
export type Trigger =
  | 'trial_charge_succeeded'
  | 'trial_charge_failed'
  | 'charge_succeeded'
  | 'charge_failed'
  | 'retries_exhausted'
  | 'cancel';

/**
 * The lifecycle expressed as an explicit transition table rather than a
 * `status` string mutated ad hoc from multiple call sites. Any (state,
 * trigger) pair not listed here is structurally impossible to apply -
 * SubscriptionStateMachine.nextState() throws, it never guesses or falls
 * through to a default.
 */
const TRANSITIONS: Record<SubscriptionStatus, Partial<Record<Trigger, SubscriptionStatus>>> = {
  trialing: {
    trial_charge_succeeded: 'active',
    trial_charge_failed: 'past_due',
    cancel: 'canceled',
  },
  active: {
    charge_failed: 'past_due',
    cancel: 'canceled',
  },
  past_due: {
    charge_succeeded: 'active',
    retries_exhausted: 'canceled',
  },
  // canceled is terminal - intentionally empty. No trigger produces a
  // transition out of it, which is what makes "canceled -> active via a
  // stray webhook" structurally impossible rather than just tested-against.
  canceled: {},
};

export class InvalidTransitionError extends Error {
  constructor(from: SubscriptionStatus, trigger: Trigger) {
    super(`Invalid transition: cannot apply '${trigger}' from state '${from}'`);
    this.name = 'InvalidTransitionError';
  }
}

export class SubscriptionStateMachine {
  /** Returns the next state, or throws InvalidTransitionError if the transition is illegal. */
  static nextState(current: SubscriptionStatus, trigger: Trigger): SubscriptionStatus {
    const next = TRANSITIONS[current][trigger];
    if (!next) {
      throw new InvalidTransitionError(current, trigger);
    }
    return next;
  }

  /** Non-throwing check, used by webhook handling to decide whether to apply or silently ignore. */
  static canTransition(current: SubscriptionStatus, trigger: Trigger): boolean {
    return !!TRANSITIONS[current][trigger];
  }
}
