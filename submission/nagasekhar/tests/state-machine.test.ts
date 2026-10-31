
import { describe, it, expect } from 'vitest';
import { SubscriptionStateMachine } from '../src/state-machine.js';

describe('SubscriptionStateMachine', () => {
  const machine = new SubscriptionStateMachine();

  it.each([
    ['trialing', 'active'],
    ['trialing', 'past_due'],
    ['trialing', 'canceled'],
    ['active', 'past_due'],
    ['active', 'canceled'],
    ['past_due', 'active'],
    ['past_due', 'canceled'],
  ] as const)(
    'allows valid transition: %s -> %s',
    (current, next) => {
      expect(machine.transition(current, next)).toBe(next);
    },
  );

  it.each([
    ['canceled', 'active'],
    ['canceled', 'past_due'],
    ['active', 'trialing'],
    ['past_due', 'trialing'],
  ] as const)(
    'rejects invalid transition: %s -> %s',
    (current, next) => {
      expect(() => machine.transition(current, next)).toThrow(
        'Invalid subscription transition',
      );
    },
  );
});
