import { BillingError } from '../errors';
import type { SubscriptionRecord, SubscriptionStatus } from './Subscription';

/**
 * Subscription lifecycle as an explicit transition table keyed by (state, trigger).
 *
 * Every state change (API cancel, webhook, billing run) must go through `Subscription.apply`,
 * which consults this table. `status` is read-only on the aggregate, so there is no call site
 * that can "just set" a status, and any pair not listed here is rejected.
 */

export type SubscriptionTrigger = 'charge_succeeded' | 'charge_failed' | 'retries_exhausted' | 'cancel';

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'canceled'];

export const SUBSCRIPTION_TRIGGERS: readonly SubscriptionTrigger[] = [
  'charge_succeeded',
  'charge_failed',
  'retries_exhausted',
  'cancel',
];

type TransitionRow = ReadonlyMap<SubscriptionTrigger, SubscriptionStatus>;

// Record<SubscriptionStatus, ...> makes the compiler force a row for every state.
// A missing arrow below is an invalid transition; "canceled" has an empty row (terminal).
const TRANSITIONS: Readonly<Record<SubscriptionStatus, TransitionRow>> = {
  trialing: new Map<SubscriptionTrigger, SubscriptionStatus>([
    ['charge_succeeded', 'active'], // trial ends, first charge succeeds
    ['charge_failed', 'past_due'], // trial ends, first charge fails
    ['cancel', 'canceled'], // customer/API cancel
  ]),
  active: new Map<SubscriptionTrigger, SubscriptionStatus>([
    ['charge_failed', 'past_due'], // recurring charge fails
    ['cancel', 'canceled'], // customer/API cancel
  ]),
  past_due: new Map<SubscriptionTrigger, SubscriptionStatus>([
    ['charge_succeeded', 'active'], // retry charge succeeds
    ['retries_exhausted', 'canceled'], // retries exhausted
  ]),
  canceled: new Map<SubscriptionTrigger, SubscriptionStatus>(),
};

/** A trigger that the lifecycle does not allow in the current state. Surfaces as HTTP 409. */
export class InvalidTransitionError extends BillingError {
  constructor(
    readonly from: SubscriptionStatus,
    readonly trigger: SubscriptionTrigger,
  ) {
    super('invalid_transition', `Cannot apply "${trigger}" to a subscription in status "${from}"`);
    this.name = 'InvalidTransitionError';
  }
}

export interface TransitionResult {
  readonly from: SubscriptionStatus;
  readonly trigger: SubscriptionTrigger;
  readonly to: SubscriptionStatus;
}

/**
 * Subscription aggregate. State is private and only `apply` can change it; `toRecord()`
 * returns a copy for persistence/serialization, so callers cannot mutate state through it.
 */
export class Subscription {
  private constructor(private record: SubscriptionRecord) {}

  /** Rebuild the aggregate from a stored row (copies it, so later edits to the row have no effect). */
  static rehydrate(record: SubscriptionRecord): Subscription {
    return new Subscription({ ...record });
  }

  get status(): SubscriptionStatus {
    return this.record.status;
  }

  /** Whether the table has an arrow for this trigger in the current state. Read-only: changes nothing. */
  can(trigger: SubscriptionTrigger): boolean {
    return TRANSITIONS[this.record.status].has(trigger);
  }

  /** Apply a trigger. Throws InvalidTransitionError (and changes nothing) if the table has no such arrow. */
  apply(trigger: SubscriptionTrigger): TransitionResult {
    const from = this.record.status;
    const to = TRANSITIONS[from].get(trigger);
    if (to === undefined) {
      throw new InvalidTransitionError(from, trigger);
    }
    this.record = { ...this.record, status: to };
    return { from, trigger, to };
  }

  toRecord(): SubscriptionRecord {
    return { ...this.record };
  }
}
