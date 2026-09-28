import {
  LIFECYCLE_EVENTS,
  SUBSCRIPTION_STATUSES,
  SubscriptionStateMachine,
  type LifecycleEvent,
} from '../../../src/domain/SubscriptionStateMachine';
import { InvalidTransitionError } from '../../../src/domain/errors';
import type { SubscriptionStatus } from '../../../src/domain/types';

/**
 * The expected table is written out by hand from the assignment's diagram
 * (NOT derived from production code) - otherwise the test would be a tautology.
 */
const SPEC: Array<[SubscriptionStatus, LifecycleEvent, SubscriptionStatus, string]> = [
  ['trialing', 'PAYMENT_SUCCEEDED', 'active', 'trial ends, first charge succeeds'],
  ['trialing', 'PAYMENT_FAILED', 'past_due', 'trial ends, first charge fails'],
  ['active', 'PAYMENT_FAILED', 'past_due', 'recurring charge fails'],
  ['past_due', 'PAYMENT_SUCCEEDED', 'active', 'retry charge succeeds'],
  ['past_due', 'RETRIES_EXHAUSTED', 'canceled', 'retries exhausted'],
  ['active', 'CANCEL', 'canceled', 'customer/API cancel'],
  ['trialing', 'CANCEL', 'canceled', 'customer/API cancel'],
  // documented self-loops (no status change)
  ['active', 'PAYMENT_SUCCEEDED', 'active', 'renewal succeeds'],
  ['past_due', 'PAYMENT_FAILED', 'past_due', 'retry fails, budget remaining'],
];

describe('SubscriptionStateMachine (unit)', () => {
  it.each(SPEC)('%s --%s--> %s (%s)', (from, event, to) => {
    expect(SubscriptionStateMachine.next(from, event)).toBe(to);
  });

  const allowed = new Set(SPEC.map(([f, e]) => `${f}:${e}`));
  const forbidden = SUBSCRIPTION_STATUSES.flatMap((f) =>
    LIFECYCLE_EVENTS.filter((e) => !allowed.has(`${f}:${e}`)).map((e) => [f, e] as const),
  );

  it.each(forbidden)('rejects %s --%s-->', (from, event) => {
    expect(SubscriptionStateMachine.canApply(from, event)).toBe(false);
    expect(() => SubscriptionStateMachine.next(from, event)).toThrow(InvalidTransitionError);
  });

  it('canceled is terminal for every event', () => {
    expect(SubscriptionStateMachine.isTerminal('canceled')).toBe(true);
    LIFECYCLE_EVENTS.forEach((e) => expect(SubscriptionStateMachine.canApply('canceled', e)).toBe(false));
  });

  it('production table contains exactly the specified transitions (nothing extra sneaks in)', () => {
    const actual = SubscriptionStateMachine.allTransitions().map((t) => `${t.from}:${t.event}:${t.to}`).sort();
    const expected = SPEC.map(([f, e, t]) => `${f}:${e}:${t}`).sort();
    expect(actual).toEqual(expected);
  });
});
