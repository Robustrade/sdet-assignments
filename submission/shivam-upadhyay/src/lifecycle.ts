import type { SubscriptionState } from './types';

/**
 * The single source of truth for the subscription lifecycle.
 * Only the transitions listed here are valid — anything else is rejected or
 * safely ignored, never silently accepted. Cancel is allowed only from
 * trialing/active (per the assignment's lifecycle list); past_due reaches
 * canceled only via retries_exhausted.
 */
export type LifecycleEvent =
  | 'trial_charge_succeeded'
  | 'trial_charge_failed'
  | 'recurring_charge_failed'
  | 'retry_succeeded'
  | 'retries_exhausted'
  | 'cancel';

const TRANSITIONS: Record<SubscriptionState, Partial<Record<LifecycleEvent, SubscriptionState>>> = {
  trialing: {
    trial_charge_succeeded: 'active',
    trial_charge_failed: 'past_due',
    cancel: 'canceled',
  },
  active: {
    recurring_charge_failed: 'past_due',
    cancel: 'canceled',
  },
  past_due: {
    retry_succeeded: 'active',
    retries_exhausted: 'canceled',
  },
  canceled: {},
};

export function nextState(from: SubscriptionState, event: LifecycleEvent): SubscriptionState | null {
  return TRANSITIONS[from][event] ?? null;
}

export function canTransition(from: SubscriptionState, event: LifecycleEvent): boolean {
  return nextState(from, event) !== null;
}
