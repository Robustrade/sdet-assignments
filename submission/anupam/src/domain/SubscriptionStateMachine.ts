import { InvalidTransitionError } from './errors';
import type { SubscriptionStatus } from './types';

/** Business triggers that can move a subscription. */
export type LifecycleEvent =
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'RETRIES_EXHAUSTED'
  | 'CANCEL';

export const LIFECYCLE_EVENTS: readonly LifecycleEvent[] = [
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'RETRIES_EXHAUSTED',
  'CANCEL',
];
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
];

/**
 * PATTERN: explicit transition table (table-driven State Machine).
 *
 * The ONLY source of truth for legal lifecycle moves. Anything not in this
 * table is illegal. Two self-loops are listed explicitly so that they are a
 * deliberate decision, not an accident:
 *   - active   + PAYMENT_SUCCEEDED -> active   (successful renewal)
 *   - past_due + PAYMENT_FAILED    -> past_due (a retry failed, budget left)
 */
const TRANSITIONS: Readonly<
  Record<SubscriptionStatus, Readonly<Partial<Record<LifecycleEvent, SubscriptionStatus>>>>
> = Object.freeze({
  trialing: { PAYMENT_SUCCEEDED: 'active', PAYMENT_FAILED: 'past_due', CANCEL: 'canceled' },
  active: { PAYMENT_SUCCEEDED: 'active', PAYMENT_FAILED: 'past_due', CANCEL: 'canceled' },
  past_due: { PAYMENT_SUCCEEDED: 'active', PAYMENT_FAILED: 'past_due', RETRIES_EXHAUSTED: 'canceled' },
  canceled: {}, // terminal
});

export interface Transition {
  from: SubscriptionStatus;
  event: LifecycleEvent;
  to: SubscriptionStatus;
}

export class SubscriptionStateMachine {
  static canApply(from: SubscriptionStatus, event: LifecycleEvent): boolean {
    return TRANSITIONS[from][event] !== undefined;
  }

  /** Returns the next state or throws. Never returns an undefined/unknown state. */
  static next(from: SubscriptionStatus, event: LifecycleEvent): SubscriptionStatus {
    const to = TRANSITIONS[from][event];
    if (to === undefined) throw new InvalidTransitionError(from, event);
    return to;
  }

  static isTerminal(status: SubscriptionStatus): boolean {
    return Object.keys(TRANSITIONS[status]).length === 0;
  }

  static allTransitions(): Transition[] {
    return SUBSCRIPTION_STATUSES.flatMap((from) =>
      (Object.entries(TRANSITIONS[from]) as [LifecycleEvent, SubscriptionStatus][]).map(
        ([event, to]) => ({ from, event, to }),
      ),
    );
  }
}
