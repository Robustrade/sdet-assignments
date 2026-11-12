import { describe, expect, it } from 'vitest';
import { IllegalTransitionError } from '../../src/domain/errors';
import { SubscriptionStateMachine } from '../../src/domain/subscriptionStateMachine';
import {
  LIFECYCLE_TRIGGERS,
  SUBSCRIPTION_STATUSES,
  type LifecycleTrigger,
  type SubscriptionStatus,
} from '../../src/domain/types';

interface Case {
  readonly from: SubscriptionStatus;
  readonly trigger: LifecycleTrigger;
}

// The 7 transitions from the brief, written out by hand (not read from the service).
const VALID: ReadonlyArray<Case & { readonly to: SubscriptionStatus }> = [
  { from: 'trialing', trigger: 'charge_succeeded', to: 'active' },
  { from: 'trialing', trigger: 'charge_failed', to: 'past_due' },
  { from: 'active', trigger: 'charge_failed', to: 'past_due' },
  { from: 'past_due', trigger: 'charge_succeeded', to: 'active' },
  { from: 'past_due', trigger: 'retries_exhausted', to: 'canceled' },
  { from: 'active', trigger: 'cancel_requested', to: 'canceled' },
  { from: 'trialing', trigger: 'cancel_requested', to: 'canceled' },
];

const INVALID: readonly Case[] = SUBSCRIPTION_STATUSES.flatMap((from) =>
  LIFECYCLE_TRIGGERS.map((trigger) => ({ from, trigger })),
).filter((candidate) => !VALID.some((valid) => valid.from === candidate.from && valid.trigger === candidate.trigger));

describe('E5. SubscriptionStateMachine (unit)', () => {
  it.each(VALID)('allows $from --$trigger--> $to', ({ from, trigger, to }) => {
    const transition = SubscriptionStateMachine.transition(from, trigger);

    expect({ from: transition.from, to: transition.to, trigger: transition.trigger }).toEqual({ from, to, trigger });
    expect(SubscriptionStateMachine.canApply(from, trigger)).toBe(true);
  });

  it('rejects every one of the other 9 status/trigger combinations', () => {
    expect(INVALID).toHaveLength(SUBSCRIPTION_STATUSES.length * LIFECYCLE_TRIGGERS.length - VALID.length);
    expect(INVALID).toHaveLength(9);
  });

  it.each(INVALID)('rejects $trigger while $from', ({ from, trigger }) => {
    expect(SubscriptionStateMachine.canApply(from, trigger)).toBe(false);
    expect(() => SubscriptionStateMachine.transition(from, trigger)).toThrow(IllegalTransitionError);
  });

  it('has no way out of canceled', () => {
    for (const trigger of LIFECYCLE_TRIGGERS) {
      expect(SubscriptionStateMachine.canApply('canceled', trigger)).toBe(false);
    }
  });

  it('tells the caller which status and trigger were refused', () => {
    try {
      SubscriptionStateMachine.transition('canceled', 'charge_succeeded');
      expect.unreachable('transition should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const refused = error as IllegalTransitionError;
      expect([refused.from, refused.trigger, refused.code]).toEqual(['canceled', 'charge_succeeded', 'INVALID_TRANSITION']);
    }
  });
});
