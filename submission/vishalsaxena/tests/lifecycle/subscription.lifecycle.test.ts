
import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transitionSubscription
} from '../../src/state/SubscriptionStateMachine';

describe('Subscription State Machine', () => {
  it('should allow trialing to active', () => {
    expect(canTransition('trialing', 'active')).toBe(true);
  });

  it('should allow trialing to past_due after payment failure', () => {
    expect(canTransition('trialing', 'past_due')).toBe(true);
  });

  it('should allow active to past_due', () => {
    expect(canTransition('active', 'past_due')).toBe(true);
  });

  it('should allow past_due to active after successful payment retry', () => {
    expect(canTransition('past_due', 'active')).toBe(true);
  });

  it('should allow past_due to canceled', () => {
    expect(canTransition('past_due', 'canceled')).toBe(true);
  });

  it('should allow trialing to canceled', () => {
    expect(canTransition('trialing', 'canceled')).toBe(true);
  });

  it('should reject canceled to active', () => {
    expect(canTransition('canceled', 'active')).toBe(false);
  });

  it('should reject canceled to past_due', () => {
    expect(canTransition('canceled', 'past_due')).toBe(false);
  });

  it('should reject active to trialing', () => {
    expect(canTransition('active', 'trialing')).toBe(false);
  });

  it('should throw error for invalid transition', () => {
    expect(() =>
      transitionSubscription('canceled', 'active')
    ).toThrow('Invalid subscription transition');
  });
});
