import { isAllowedTransition, nextStatus } from '../../src/domain/subscription-state-machine';
import { SUBSCRIPTION_STATUSES, SubscriptionStatus } from '../../src/domain/types';

/** U-01: the transition table allows exactly the seven required transitions - nothing else. */
describe('U-01 subscription transition table', () => {
  const REQUIRED: Array<[SubscriptionStatus, SubscriptionStatus]> = [
    ['trialing', 'active'], //   T1
    ['trialing', 'past_due'], // T2
    ['active', 'past_due'], //   T3
    ['past_due', 'active'], //   T4
    ['past_due', 'canceled'], // T5
    ['active', 'canceled'], //   T6
    ['trialing', 'canceled'], // T7
  ];

  const allPairs = SUBSCRIPTION_STATUSES.flatMap((from) => SUBSCRIPTION_STATUSES.map((to) => [from, to] as const));

  test.each(allPairs)('%s -> %s is allowed only if it is a required transition', (from, to) => {
    const expected = REQUIRED.some(([f, t]) => f === from && t === to);
    expect(isAllowedTransition(from, to)).toBe(expected);
  });

  test('exactly 7 of the 16 possible pairs are allowed', () => {
    expect(allPairs.filter(([f, t]) => isAllowedTransition(f, t))).toHaveLength(7);
  });

  test('triggers map to the documented targets', () => {
    expect(nextStatus('trialing', 'charge_succeeded')).toBe('active');
    expect(nextStatus('trialing', 'charge_failed')).toBe('past_due');
    expect(nextStatus('active', 'charge_failed')).toBe('past_due');
    expect(nextStatus('past_due', 'charge_succeeded')).toBe('active');
    expect(nextStatus('past_due', 'retries_exhausted')).toBe('canceled');
    expect(nextStatus('active', 'cancel_requested')).toBe('canceled');
    expect(nextStatus('trialing', 'cancel_requested')).toBe('canceled');
  });

  test('canceled is terminal: no trigger leaves it', () => {
    for (const trigger of ['charge_succeeded', 'charge_failed', 'cancel_requested', 'retries_exhausted'] as const) {
      expect(nextStatus('canceled', trigger)).toBeNull();
    }
  });

  test('past_due cannot be canceled by the customer (strict reading, assumption A-07)', () => {
    expect(nextStatus('past_due', 'cancel_requested')).toBeNull();
  });
});
