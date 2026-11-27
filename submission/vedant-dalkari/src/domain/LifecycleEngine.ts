/**
 * Subscription lifecycle state machine and branded ApprovedTransition producer.
 * Author: Vedant Dalkari
 */

import { InvalidTransitionError } from './errors.js';
import type { ApprovedTransition, SubscriptionStatus, TransitionTrigger } from './types.js';

export interface TransitionRule {
  readonly from: SubscriptionStatus | null;
  readonly trigger: TransitionTrigger;
  readonly to: SubscriptionStatus;
}

const TRANSITION_TABLE: readonly TransitionRule[] = [
  // Initial creation edges
  { from: null, trigger: 'signup_trial', to: 'trialing' },
  { from: null, trigger: 'signup_charge_succeeded', to: 'active' },
  { from: null, trigger: 'signup_charge_failed', to: 'past_due' },

  // 1. trialing -> active
  { from: 'trialing', trigger: 'trial_charge_succeeded', to: 'active' },
  { from: 'trialing', trigger: 'payment_succeeded_webhook', to: 'active' },

  // 2. trialing -> past_due
  { from: 'trialing', trigger: 'trial_charge_failed', to: 'past_due' },
  { from: 'trialing', trigger: 'payment_failed_webhook', to: 'past_due' },

  // 3. active -> past_due
  { from: 'active', trigger: 'renewal_charge_failed', to: 'past_due' },
  { from: 'active', trigger: 'payment_failed_webhook', to: 'past_due' },

  // 4. past_due -> active
  { from: 'past_due', trigger: 'retry_charge_succeeded', to: 'active' },
  { from: 'past_due', trigger: 'payment_succeeded_webhook', to: 'active' },

  // 5. past_due -> canceled
  { from: 'past_due', trigger: 'retries_exhausted', to: 'canceled' },
  { from: 'past_due', trigger: 'payment_refunded_webhook', to: 'canceled' },

  // 6. active -> canceled
  { from: 'active', trigger: 'api_cancel', to: 'canceled' },
  { from: 'active', trigger: 'payment_refunded_webhook', to: 'canceled' },

  // 7. trialing -> canceled
  { from: 'trialing', trigger: 'api_cancel', to: 'canceled' },
];

const RUNTIME_TRANSITION_SYMBOL = Symbol('ApprovedTransitionRuntimeToken');

export function hasApprovedTransitionMarker(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Reflect.get(value, RUNTIME_TRANSITION_SYMBOL) === true;
}

export class LifecycleEngine {
  private readonly rulesByKey: Map<string, TransitionRule>;

  public constructor(rules: readonly TransitionRule[] = TRANSITION_TABLE) {
    this.rulesByKey = new Map(
      rules.map((rule) => [this.edgeKey(rule.from, rule.trigger), rule]),
    );
  }

  public transition(
    current: SubscriptionStatus | null,
    trigger: TransitionTrigger,
  ): ApprovedTransition {
    const rule = this.rulesByKey.get(this.edgeKey(current, trigger));
    if (!rule) {
      throw new InvalidTransitionError(current, trigger);
    }
    return this.createApprovedToken(rule.from, rule.to, rule.trigger);
  }

  public canTransition(
    current: SubscriptionStatus | null,
    trigger: TransitionTrigger,
  ): boolean {
    return this.rulesByKey.has(this.edgeKey(current, trigger));
  }

  public getAllowedTransitions(): readonly TransitionRule[] {
    return TRANSITION_TABLE;
  }

  protected createApprovedToken(
    fromStatus: SubscriptionStatus | null,
    toStatus: SubscriptionStatus,
    trigger: TransitionTrigger,
  ): ApprovedTransition {
    const token = {
      [RUNTIME_TRANSITION_SYMBOL]: true,
      fromStatus,
      toStatus,
      trigger,
    };
    return Object.freeze(token) as unknown as ApprovedTransition;
  }

  private edgeKey(from: SubscriptionStatus | null, trigger: TransitionTrigger): string {
    return `${String(from)}::${trigger}`;
  }
}
