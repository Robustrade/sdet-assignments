import { SubscriptionStatus } from './types';

/**
 * Subscription lifecycle as an explicit transition table (State pattern, design §9).
 *
 * This table is the ONLY place that knows which moves are legal. Services never
 * assign a status directly; they ask `nextStatus(current, trigger)` and treat
 * `null` as "this move is not allowed". Any pair not listed here is invalid.
 */
export type SubscriptionTrigger =
  | 'charge_succeeded'
  | 'charge_failed'
  | 'cancel_requested'
  | 'retries_exhausted';

const TRANSITIONS: Readonly<Record<SubscriptionStatus, Partial<Record<SubscriptionTrigger, SubscriptionStatus>>>> = {
  trialing: {
    charge_succeeded: 'active', //   T1: trial ends, first charge succeeds
    charge_failed: 'past_due', //    T2: trial ends, first charge fails
    cancel_requested: 'canceled', // T7: customer/API cancel
  },
  active: {
    charge_failed: 'past_due', //    T3: recurring charge fails
    cancel_requested: 'canceled', // T6: customer/API cancel
  },
  past_due: {
    charge_succeeded: 'active', //   T4: retry charge succeeds
    retries_exhausted: 'canceled', // T5: retries exhausted
  },
  canceled: {}, // terminal: nothing leaves canceled
};

/** Returns the next status, or `null` when the trigger is not allowed from `current`. */
export function nextStatus(current: SubscriptionStatus, trigger: SubscriptionTrigger): SubscriptionStatus | null {
  return TRANSITIONS[current][trigger] ?? null;
}

/** True when some trigger moves `from` to `to` (used by the exhaustive U-01 test). */
export function isAllowedTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return Object.values(TRANSITIONS[from]).includes(to);
}
