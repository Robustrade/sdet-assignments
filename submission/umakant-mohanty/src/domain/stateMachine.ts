import { SubscriptionStatus } from './models';

export type TransitionTrigger =
  | 'trial_charge_succeeded'
  | 'trial_charge_failed'
  | 'recurring_charge_failed'
  | 'retry_charge_succeeded'
  | 'retries_exhausted'
  | 'customer_cancel';

const TRANSITIONS: Readonly<Record<SubscriptionStatus, Partial<Record<TransitionTrigger, SubscriptionStatus>>>> = {
  trialing: {
    trial_charge_succeeded: 'active',
    trial_charge_failed: 'past_due',
    customer_cancel: 'canceled'
  },
  active: {
    recurring_charge_failed: 'past_due',
    customer_cancel: 'canceled'
  },
  past_due: {
    retry_charge_succeeded: 'active',
    retries_exhausted: 'canceled'
  },
  canceled: {}
};

export class SubscriptionStateMachine {
  canTransition(from: SubscriptionStatus, trigger: TransitionTrigger): boolean {
    return TRANSITIONS[from][trigger] !== undefined;
  }

  transition(from: SubscriptionStatus, trigger: TransitionTrigger): SubscriptionStatus {
    const to = TRANSITIONS[from][trigger];
    if (!to) {
      throw new Error(`Invalid subscription transition: ${from} --${trigger}--> ?`);
    }
    return to;
  }
}
