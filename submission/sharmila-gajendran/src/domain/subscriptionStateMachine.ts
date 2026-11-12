import { IllegalTransitionError } from './errors';
import type { LifecycleTrigger, SubscriptionStatus } from './types';

declare const transitionBrand: unique symbol;

/**
 * A transition approved by the state machine. Only `SubscriptionStateMachine.transition()`
 * creates one, and the repository only accepts this type to change a status, so there is
 * no way to save a status change that skipped the table below.
 */
export interface Transition {
  readonly from: SubscriptionStatus;
  readonly to: SubscriptionStatus;
  readonly trigger: LifecycleTrigger;
  readonly [transitionBrand]: true;
}

/**
 * The whole lifecycle in one place. Anything not listed here is rejected.
 *
 *   trialing --charge_succeeded--> active      (trial ended, first charge succeeded)
 *   trialing --charge_failed-----> past_due    (trial ended, first charge failed)
 *   trialing --cancel_requested--> canceled
 *   active   --charge_failed-----> past_due    (renewal failed)
 *   active   --cancel_requested--> canceled
 *   past_due --charge_succeeded--> active      (retry succeeded)
 *   past_due --retries_exhausted-> canceled
 *   canceled: final, nothing leaves it
 */
const TRANSITIONS: Readonly<Record<SubscriptionStatus, Readonly<Partial<Record<LifecycleTrigger, SubscriptionStatus>>>>> =
  Object.freeze({
    trialing: Object.freeze({ charge_succeeded: 'active', charge_failed: 'past_due', cancel_requested: 'canceled' }),
    active: Object.freeze({ charge_failed: 'past_due', cancel_requested: 'canceled' }),
    past_due: Object.freeze({ charge_succeeded: 'active', retries_exhausted: 'canceled' }),
    canceled: Object.freeze({}),
  });

export const SubscriptionStateMachine = {
  canApply(from: SubscriptionStatus, trigger: LifecycleTrigger): boolean {
    return TRANSITIONS[from][trigger] !== undefined;
  },

  /** Returns the approved transition, or throws IllegalTransitionError. */
  transition(from: SubscriptionStatus, trigger: LifecycleTrigger): Transition {
    const to = TRANSITIONS[from][trigger];
    if (to === undefined) {
      throw new IllegalTransitionError(from, trigger);
    }
    return { from, to, trigger } as Transition;
  },
} as const;
