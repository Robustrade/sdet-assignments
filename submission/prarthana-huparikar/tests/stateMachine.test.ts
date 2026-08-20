import { SubscriptionStateMachine, InvalidTransitionError, Trigger } from '../src/domain/SubscriptionState';
import { SubscriptionStatus } from '../src/domain/types';

describe('SubscriptionStateMachine - valid transitions', () => {
  const validTransitions: Array<[SubscriptionStatus, Trigger, SubscriptionStatus]> = [
    ['trialing', 'trial_charge_succeeded', 'active'],
    ['trialing', 'trial_charge_failed', 'past_due'],
    ['trialing', 'cancel', 'canceled'],
    ['active', 'charge_failed', 'past_due'],
    ['active', 'cancel', 'canceled'],
    ['past_due', 'charge_succeeded', 'active'],
    ['past_due', 'retries_exhausted', 'canceled'],
  ];

  test.each(validTransitions)('%s --(%s)--> %s', (from, trigger, to) => {
    expect(SubscriptionStateMachine.nextState(from, trigger)).toBe(to);
    expect(SubscriptionStateMachine.canTransition(from, trigger)).toBe(true);
  });
});

describe('SubscriptionStateMachine - invalid transitions', () => {
  test('canceled -> active via a stray payment.succeeded webhook is impossible', () => {
    expect(() => SubscriptionStateMachine.nextState('canceled', 'charge_succeeded')).toThrow(InvalidTransitionError);
    expect(SubscriptionStateMachine.canTransition('canceled', 'charge_succeeded')).toBe(false);
  });

  test('trialing cannot jump straight to canceled via retries_exhausted (no retries exist pre-charge)', () => {
    expect(() => SubscriptionStateMachine.nextState('trialing', 'retries_exhausted')).toThrow(InvalidTransitionError);
  });

  test('canceled is terminal - no trigger produces any transition out of it', () => {
    const allTriggers: Trigger[] = [
      'trial_charge_succeeded',
      'trial_charge_failed',
      'charge_succeeded',
      'charge_failed',
      'retries_exhausted',
      'cancel',
    ];
    allTriggers.forEach((trigger) => {
      expect(SubscriptionStateMachine.canTransition('canceled', trigger)).toBe(false);
    });
  });
});
