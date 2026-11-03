import { ConflictError } from '../shared/errors';

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const LIFECYCLE_TRIGGERS = [
  'charge_succeeded',
  'charge_failed',
  'retry_failed',
  'retries_exhausted',
  'cancel_requested',
] as const;
export type LifecycleTrigger = (typeof LIFECYCLE_TRIGGERS)[number];

/**
 * The complete lifecycle. A (status, trigger) pair that is not listed here is illegal.
 * Self-loops (active renewal, past_due retry) are listed explicitly so they are legal
 * *triggers* even though they do not change the status.
 */
const TRANSITIONS: Readonly<Record<SubscriptionStatus, Readonly<Partial<Record<LifecycleTrigger, SubscriptionStatus>>>>> = {
  trialing: { charge_succeeded: 'active', charge_failed: 'past_due', cancel_requested: 'canceled' },
  active: { charge_succeeded: 'active', charge_failed: 'past_due', cancel_requested: 'canceled' },
  past_due: { charge_succeeded: 'active', retry_failed: 'past_due', retries_exhausted: 'canceled' },
  canceled: {},
};

export class IllegalTransitionError extends ConflictError {
  constructor(
    readonly from: SubscriptionStatus,
    readonly trigger: LifecycleTrigger,
  ) {
    super('invalid_transition', `Cannot apply '${trigger}' to a subscription in '${from}'`);
  }
}

export class SubscriptionStateMachine {
  static readonly initialStatus: SubscriptionStatus = 'trialing';

  static can(from: SubscriptionStatus, trigger: LifecycleTrigger): boolean {
    return TRANSITIONS[from][trigger] !== undefined;
  }

  static next(from: SubscriptionStatus, trigger: LifecycleTrigger): SubscriptionStatus {
    const to = TRANSITIONS[from][trigger];
    if (to === undefined) throw new IllegalTransitionError(from, trigger);
    return to;
  }

  static triggersFrom(from: SubscriptionStatus): LifecycleTrigger[] {
    return Object.keys(TRANSITIONS[from]) as LifecycleTrigger[];
  }

  /** Distinct status changes (self-loops excluded). Feeds the database trigger. */
  static statusEdges(): Array<[SubscriptionStatus, SubscriptionStatus]> {
    const edges = new Map<string, [SubscriptionStatus, SubscriptionStatus]>();
    for (const from of SUBSCRIPTION_STATUSES) {
      for (const to of Object.values(TRANSITIONS[from])) {
        if (to !== from) edges.set(`${from}->${to}`, [from, to]);
      }
    }
    return [...edges.values()];
  }

  static isTerminal(status: SubscriptionStatus): boolean {
    return SubscriptionStateMachine.triggersFrom(status).length === 0;
  }

  /** Plan changes are not status transitions, but they are only meaningful for a live, paid-up subscription. */
  static allowsPlanChange(status: SubscriptionStatus): boolean {
    return status === 'trialing' || status === 'active';
  }
}
