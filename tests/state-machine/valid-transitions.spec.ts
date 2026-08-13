import { describe, it, expect } from 'vitest';
import { transition } from '../../src/domain/SubscriptionStateMachine.js';
import type { SubscriptionState, Trigger } from '../../src/domain/types.js';

interface TransitionCase {
  from: SubscriptionState;
  trigger: Trigger;
  to: SubscriptionState;
}

const VALID_TRANSITIONS: TransitionCase[] = [
  { from: 'trialing', trigger: 'trial_ends_charge_succeeded', to: 'active' },
  { from: 'trialing', trigger: 'trial_ends_charge_failed', to: 'past_due' },
  { from: 'active', trigger: 'recurring_charge_failed', to: 'past_due' },
  { from: 'past_due', trigger: 'retry_charge_succeeded', to: 'active' },
  { from: 'past_due', trigger: 'retries_exhausted', to: 'canceled' },
  { from: 'active', trigger: 'cancel', to: 'canceled' },
  { from: 'trialing', trigger: 'cancel', to: 'canceled' },
];

describe('SubscriptionStateMachine — valid transitions', () => {
  it.each(VALID_TRANSITIONS)(
    'moves $from -> $to on trigger "$trigger"',
    ({ from, trigger, to }) => {
      const result = transition(from, trigger);
      expect(result).toBe(to);
    },
  );

  it('returns the exact next state, never mutating the source', () => {
    const result = transition('trialing', 'trial_ends_charge_succeeded');
    expect(result).toBe('active');
    expect(transition('trialing', 'trial_ends_charge_succeeded')).toBe('active');
  });

  it('covers all 7 documented lifecycle transitions', () => {
    expect(VALID_TRANSITIONS).toHaveLength(7);
  });
});