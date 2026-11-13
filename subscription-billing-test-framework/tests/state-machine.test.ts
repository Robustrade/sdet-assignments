import { SubscriptionStateMachine } from '../src/domain/state-machine';
import { describe, expect, it } from '@jest/globals';

describe('SubscriptionStateMachine & Lifecycle Invariants', () => {
  it('allows valid transitions from trialing', () => {
    expect(SubscriptionStateMachine.canTransition('trialing', 'active')).toBe(true);
    expect(SubscriptionStateMachine.canTransition('trialing', 'past_due')).toBe(true);
    expect(SubscriptionStateMachine.canTransition('trialing', 'canceled')).toBe(true);
  });

  it('allows valid transitions from active', () => {
    expect(SubscriptionStateMachine.canTransition('active', 'past_due')).toBe(true);
    expect(SubscriptionStateMachine.canTransition('active', 'canceled')).toBe(true);
    expect(SubscriptionStateMachine.canTransition('active', 'trialing')).toBe(false);
  });

  it('treats canceled state as strictly terminal', () => {
    expect(SubscriptionStateMachine.canTransition('canceled', 'active')).toBe(false);
    expect(SubscriptionStateMachine.canTransition('canceled', 'trialing')).toBe(false);
    expect(SubscriptionStateMachine.canTransition('canceled', 'past_due')).toBe(false);

    expect(() => SubscriptionStateMachine.transition('canceled', 'active')).toThrow();
  });
});