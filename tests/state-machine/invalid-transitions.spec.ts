import { describe, it, expect } from 'vitest';
import { transition } from '../../src/domain/SubscriptionStateMachine.js';
import type { SubscriptionState, Trigger } from '../../src/domain/types.js';

interface InvalidCase {
  from: SubscriptionState;
  trigger: Trigger;
  reason: string;
}

const INVALID_TRANSITIONS: InvalidCase[] = [
  { from: 'canceled', trigger: 'cancel', reason: 'double cancel is illegal' },
  { from: 'canceled', trigger: 'trial_ends_charge_succeeded', reason: 'canceled is terminal, no webhook can revive it' },
  { from: 'canceled', trigger: 'retry_charge_succeeded', reason: 'canceled is terminal, even a successful retry cannot revive it' },
  { from: 'trialing', trigger: 'recurring_charge_failed', reason: 'no recurring charge during trial' },
  { from: 'active', trigger: 'trial_ends_charge_succeeded', reason: 'trial already ended for an active subscription' },
  { from: 'active', trigger: 'retries_exhausted', reason: 'retry exhaustion only applies from past_due' },
  { from: 'past_due', trigger: 'recurring_charge_failed', reason: 'past_due uses retries, not recurring failures' },
];

describe('SubscriptionStateMachine — invalid transitions', () => {
  it.each(INVALID_TRANSITIONS)(
    'rejects $from -> "$trigger" (reason: $reason)',
    ({ from, trigger }) => {
      expect(transition(from, trigger)).toBeNull();
    },
  );

  it('returns null (never throws) for illegal moves so callers decide the response', () => {
    const result = transition('canceled', 'trial_ends_charge_succeeded');
    expect(result).toBeNull();
  });

  it('covers at least two invalid transitions', () => {
    expect(INVALID_TRANSITIONS.length).toBeGreaterThanOrEqual(2);
  });
});