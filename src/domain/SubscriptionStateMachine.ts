import type { SubscriptionState, Trigger } from './types.js';

const TRANSITIONS: Record<SubscriptionState, Partial<Record<Trigger, SubscriptionState>>> = {
  trialing: {
    trial_ends_charge_succeeded: 'active',
    trial_ends_charge_failed: 'past_due',
    cancel: 'canceled',
  },
  active: {
    recurring_charge_failed: 'past_due',
    cancel: 'canceled',
  },
  past_due: {
    retry_charge_succeeded: 'active',
    retries_exhausted: 'canceled',
  },
  canceled: {},
};

export function transition(
  current: SubscriptionState,
  trigger: Trigger,
): SubscriptionState | null {
  return TRANSITIONS[current]?.[trigger] ?? null;
}

export function isLegalTransition(
  current: SubscriptionState,
  trigger: Trigger,
): boolean {
  return transition(current, trigger) !== null;
}

export const ALL_STATES: readonly SubscriptionState[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
];