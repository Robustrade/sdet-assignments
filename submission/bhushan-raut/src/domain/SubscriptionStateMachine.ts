export const STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export type Status = (typeof STATUSES)[number];

export const TRIGGERS = [
  'TRIAL_CHARGE_SUCCEEDED',
  'TRIAL_CHARGE_FAILED',
  'RENEWAL_CHARGE_FAILED',
  'RETRY_SUCCEEDED',
  'RETRIES_EXHAUSTED',
  'CANCEL_REQUESTED',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

const TABLE: Record<Status, Partial<Record<Trigger, Status>>> = {
  trialing: {
    TRIAL_CHARGE_SUCCEEDED: 'active',
    TRIAL_CHARGE_FAILED: 'past_due',
    CANCEL_REQUESTED: 'canceled',
  },
  active: {
    RENEWAL_CHARGE_FAILED: 'past_due',
    CANCEL_REQUESTED: 'canceled',
  },
  past_due: {
    RETRY_SUCCEEDED: 'active',
    RETRIES_EXHAUSTED: 'canceled',
  },
  canceled: {},
};

declare const issuedByStateMachine: unique symbol;

/**
 * Branded: only SubscriptionStateMachine.apply can produce one. Persistence code that
 * accepts a Transition (rather than a raw Status) therefore cannot be handed an
 * unvalidated status change — illegal transitions are unrepresentable, not just unchecked.
 */
export interface Transition {
  readonly from: Status;
  readonly trigger: Trigger;
  readonly to: Status;
  readonly [issuedByStateMachine]: true;
}

export interface InvalidTransition {
  readonly name: 'InvalidTransition';
  readonly from: Status;
  readonly trigger: Trigger;
}

export type TransitionResult =
  | { readonly ok: true; readonly transition: Transition }
  | { readonly ok: false; readonly error: InvalidTransition };

export class SubscriptionStateMachine {
  static apply(from: Status, trigger: Trigger): TransitionResult {
    const to = TABLE[from][trigger];
    if (to === undefined) {
      return { ok: false, error: { name: 'InvalidTransition', from, trigger } };
    }
    return { ok: true, transition: Object.freeze({ from, trigger, to }) as Transition };
  }

  static isTerminal(status: Status): boolean {
    return Object.keys(TABLE[status]).length === 0;
  }
}
