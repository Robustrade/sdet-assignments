import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  LIFECYCLE_TRIGGERS,
  SUBSCRIPTION_STATUSES,
  SubscriptionStateMachine,
} from '../../../src/domain/SubscriptionStateMachine';
import { DIAGRAM_EDGES, EXPECTED_TRIGGERS } from './diagram';

describe('SubscriptionStateMachine (unit)', () => {
  const allPairs = SUBSCRIPTION_STATUSES.flatMap((status) => LIFECYCLE_TRIGGERS.map((trigger) => [status, trigger] as const));
  const legal = allPairs.filter(([s, t]) => `${s}+${t}` in EXPECTED_TRIGGERS);
  const illegal = allPairs.filter(([s, t]) => !(`${s}+${t}` in EXPECTED_TRIGGERS));

  it('status changes are exactly the edges of the lifecycle diagram', () => {
    const edges = SubscriptionStateMachine.statusEdges().map(([from, to]) => `${from}->${to}`);
    expect(edges.sort()).toEqual([...DIAGRAM_EDGES].sort());
  });

  it.each(legal)('%s + %s is legal', (status, trigger) => {
    expect(SubscriptionStateMachine.can(status, trigger)).toBe(true);
    expect(SubscriptionStateMachine.next(status, trigger)).toBe(EXPECTED_TRIGGERS[`${status}+${trigger}`]);
  });

  // Exhaustive: every pair not in the table — 11 of the 20 combinations.
  it.each(illegal)('%s + %s is rejected', (status, trigger) => {
    expect(SubscriptionStateMachine.can(status, trigger)).toBe(false);
    expect(() => SubscriptionStateMachine.next(status, trigger)).toThrow(IllegalTransitionError);
  });

  it('canceled is terminal', () => {
    expect(SubscriptionStateMachine.isTerminal('canceled')).toBe(true);
    expect(SUBSCRIPTION_STATUSES.filter((s) => SubscriptionStateMachine.isTerminal(s))).toEqual(['canceled']);
  });

  it('the rejection carries the offending state and trigger for the API error', () => {
    const error = (() => {
      try {
        SubscriptionStateMachine.next('canceled', 'charge_succeeded');
      } catch (e) {
        return e as IllegalTransitionError;
      }
    })();
    expect(error).toMatchObject({ from: 'canceled', trigger: 'charge_succeeded', code: 'invalid_transition', httpStatus: 409 });
  });
});
