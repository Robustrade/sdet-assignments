import { SubscriptionStatus } from './types';

/**
 * Things that can happen to a subscription. A trigger alone does not decide the
 * next state; the (current state, trigger) pair does.
 */
export const LIFECYCLE_TRIGGERS = [
  'payment_succeeded',
  'payment_failed',
  'cancel_requested',
  'retries_exhausted',
] as const;
export type LifecycleTrigger = (typeof LIFECYCLE_TRIGGERS)[number];

type Rule =
  | { kind: 'move'; to: SubscriptionStatus }
  | { kind: 'stay' }; // event is legal but the status does not change (e.g. a renewal paid while active)

/**
 * The single source of truth for the lifecycle. Anything not listed is illegal.
 *
 *   trialing --payment_succeeded--> active      (trial ended, first charge ok)
 *   trialing --payment_failed-----> past_due    (trial ended, first charge failed)
 *   trialing --cancel_requested---> canceled
 *   active   --payment_failed-----> past_due    (renewal failed)
 *   active   --cancel_requested---> canceled
 *   past_due --payment_succeeded--> active      (retry succeeded)
 *   past_due --retries_exhausted--> canceled
 *
 * Two "stay" rules keep legitimate repeat events from being treated as errors:
 *   active   --payment_succeeded   (renewal charge paid)
 *   past_due --payment_failed      (another retry failed, budget not yet spent)
 */
const RULES: Readonly<Record<SubscriptionStatus, Partial<Record<LifecycleTrigger, Rule>>>> = {
  trialing: {
    payment_succeeded: { kind: 'move', to: 'active' },
    payment_failed: { kind: 'move', to: 'past_due' },
    cancel_requested: { kind: 'move', to: 'canceled' },
  },
  active: {
    payment_succeeded: { kind: 'stay' },
    payment_failed: { kind: 'move', to: 'past_due' },
    cancel_requested: { kind: 'move', to: 'canceled' },
  },
  past_due: {
    payment_succeeded: { kind: 'move', to: 'active' },
    payment_failed: { kind: 'stay' },
    retries_exhausted: { kind: 'move', to: 'canceled' },
  },
  canceled: {},
};

const issued = new WeakSet<object>();

/**
 * Proof that a status change was approved by the lifecycle. The persistence layer
 * only accepts status changes in this form, so code elsewhere cannot write a status
 * string directly. Instances can only be produced by {@link SubscriptionLifecycle.decide}.
 */
export interface ApprovedTransition {
  readonly subscriptionId: string;
  readonly from: SubscriptionStatus;
  readonly to: SubscriptionStatus;
  readonly trigger: LifecycleTrigger;
}

export function isApprovedTransition(value: ApprovedTransition): boolean {
  return issued.has(value);
}

export type LifecycleDecision =
  | { kind: 'transition'; transition: ApprovedTransition }
  | { kind: 'unchanged'; status: SubscriptionStatus }
  | { kind: 'rejected'; from: SubscriptionStatus; trigger: LifecycleTrigger };

export class SubscriptionLifecycle {
  static decide(subscriptionId: string, from: SubscriptionStatus, trigger: LifecycleTrigger): LifecycleDecision {
    const rule = RULES[from][trigger];
    if (!rule) return { kind: 'rejected', from, trigger };
    if (rule.kind === 'stay') return { kind: 'unchanged', status: from };

    const transition: ApprovedTransition = Object.freeze({ subscriptionId, from, to: rule.to, trigger });
    issued.add(transition);
    return { kind: 'transition', transition };
  }

  /** Every (from, trigger) pair with what the table says about it. Used by tests to drive the full matrix. */
  static table(): Array<{ from: SubscriptionStatus; trigger: LifecycleTrigger; outcome: 'move' | 'stay' | 'reject'; to?: SubscriptionStatus }> {
    const rows: Array<{ from: SubscriptionStatus; trigger: LifecycleTrigger; outcome: 'move' | 'stay' | 'reject'; to?: SubscriptionStatus }> = [];
    for (const from of Object.keys(RULES) as SubscriptionStatus[]) {
      for (const trigger of LIFECYCLE_TRIGGERS) {
        const rule = RULES[from][trigger];
        if (!rule) rows.push({ from, trigger, outcome: 'reject' });
        else if (rule.kind === 'stay') rows.push({ from, trigger, outcome: 'stay' });
        else rows.push({ from, trigger, outcome: 'move', to: rule.to });
      }
    }
    return rows;
  }
}
