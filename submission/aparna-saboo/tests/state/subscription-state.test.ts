import {
  DefaultSubscriptionStateMachine,
  subscriptionStateMachine,
} from '../../src/domain/state/subscription-state';
import { SubscriptionBuilder } from '../builders/subscription-builder';
import { SubscriptionFixture } from '../fixtures/subscription-fixture';

const validTransitions = [
  ['trialing', 'active'],
  ['trialing', 'past_due'],
  ['trialing', 'canceled'],
  ['active', 'past_due'],
  ['active', 'canceled'],
  ['past_due', 'active'],
  ['past_due', 'canceled'],
] as const;

/**
 * Once a trial has been consumed (or left), the lifecycle never allows
 * returning to `trialing`. These cover the "cannot restart trial" invariant.
 */
const trialRestartAttempts = [
  ['active', 'trialing'],
  ['past_due', 'trialing'],
  ['canceled', 'trialing'],
] as const;

const invalidTransitions = [
  ...trialRestartAttempts,
  ['active', 'active'],
  ['past_due', 'past_due'],
  ['trialing', 'trialing'],
  ['canceled', 'active'],
  ['canceled', 'past_due'],
  ['canceled', 'canceled'],
] as const;

describe('Subscription state machine', () => {
  const machine = new DefaultSubscriptionStateMachine();

  it.each(validTransitions)('canTransition() allows %s -> %s', (from, to) => {
    expect(machine.canTransition(from, to)).toBe(true);
    expect(subscriptionStateMachine.canTransition(from, to)).toBe(true);
  });

  it.each(validTransitions)('transition() returns expected value for %s -> %s', (from, to) => {
    expect(machine.transition(from, to)).toBe(`${from}->${to}`);
    expect(subscriptionStateMachine.transition(from, to)).toBe(`${from}->${to}`);
  });

  it.each(invalidTransitions)('canTransition() rejects %s -> %s', (from, to) => {
    expect(machine.canTransition(from, to)).toBe(false);
    expect(subscriptionStateMachine.canTransition(from, to)).toBe(false);
  });

  it.each(invalidTransitions)('transition() throws for %s -> %s', (from, to) => {
    expect(() => machine.transition(from, to)).toThrow(/Invalid subscription transition/i);
    expect(() => subscriptionStateMachine.transition(from, to)).toThrow(/Invalid subscription transition/i);
  });

  describe('customer cannot obtain another trial after the trial period has ended', () => {
    it('rejects restarting a trial after trialing → active', () => {
      const subscription = SubscriptionFixture.createDefault();
      expect(subscription.status).toBe('trialing');

      // Trial ends; first charge succeeds (valid lifecycle path).
      expect(machine.transition(subscription.status, 'active')).toBe('trialing->active');
      subscription.status = 'active';

      // Customer attempts to obtain another trial (invalid).
      expect(machine.canTransition(subscription.status, 'trialing')).toBe(false);
      expect(() => machine.transition(subscription.status, 'trialing')).toThrow(
        /Invalid subscription transition: active -> trialing/i,
      );

      // Existing subscription remains active; no second trial is established.
      expect(subscription.status).toBe('active');
    });

    it.each(trialRestartAttempts)(
      'rejects consumed-trial restart attempt %s -> %s and leaves status unchanged',
      (from, to) => {
        const subscription = new SubscriptionBuilder().withDefaults().withStatus(from).build();

        expect(machine.canTransition(from, to)).toBe(false);
        expect(() => machine.transition(from, to)).toThrow(
          new RegExp(`Invalid subscription transition: ${from} -> ${to}`, 'i'),
        );
        expect(subscription.status).toBe(from);
      },
    );
  });
});
