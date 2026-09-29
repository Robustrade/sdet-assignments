import { describe, expect, it } from 'vitest';
import {
  STATUSES,
  TRIGGERS,
  SubscriptionStateMachine,
  type Status,
  type Transition,
  type Trigger,
} from '../../../src/domain/SubscriptionStateMachine';

/**
 * Oracle: the lifecycle diagram from SDET_ASSIGNMENT.md, transcribed independently.
 * Deliberately NOT imported from src — if the implementation's table were wrong,
 * a test derived from it would agree with the bug.
 */
const ORACLE_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
const ORACLE_TRIGGERS = [
  'TRIAL_CHARGE_SUCCEEDED',
  'TRIAL_CHARGE_FAILED',
  'RENEWAL_CHARGE_FAILED',
  'RETRY_SUCCEEDED',
  'RETRIES_EXHAUSTED',
  'CANCEL_REQUESTED',
] as const;

const VALID: ReadonlyArray<readonly [Status, Trigger, Status]> = [
  ['trialing', 'TRIAL_CHARGE_SUCCEEDED', 'active'],
  ['trialing', 'TRIAL_CHARGE_FAILED', 'past_due'],
  ['active', 'RENEWAL_CHARGE_FAILED', 'past_due'],
  ['past_due', 'RETRY_SUCCEEDED', 'active'],
  ['past_due', 'RETRIES_EXHAUSTED', 'canceled'],
  ['active', 'CANCEL_REQUESTED', 'canceled'],
  ['trialing', 'CANCEL_REQUESTED', 'canceled'],
];

const isValid = (from: Status, trigger: Trigger) =>
  VALID.some(([f, t]) => f === from && t === trigger);

const INVALID: ReadonlyArray<readonly [Status, Trigger]> = ORACLE_STATUSES.flatMap((from) =>
  ORACLE_TRIGGERS.filter((trigger) => !isValid(from, trigger)).map((trigger) => [from, trigger] as const),
);

describe('SubscriptionStateMachine', () => {
  it('models exactly the statuses and triggers in the lifecycle diagram', () => {
    expect([...STATUSES].sort()).toEqual([...ORACLE_STATUSES].sort());
    expect([...TRIGGERS].sort()).toEqual([...ORACLE_TRIGGERS].sort());
  });

  it('covers the full matrix: 7 valid + 17 invalid (from, trigger) pairs', () => {
    expect(VALID).toHaveLength(7);
    expect(INVALID).toHaveLength(ORACLE_STATUSES.length * ORACLE_TRIGGERS.length - VALID.length);
  });

  describe('valid transitions', () => {
    it.each(VALID)('%s --%s--> %s', (from, trigger, to) => {
      const result = SubscriptionStateMachine.apply(from, trigger);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.transition).toMatchObject({ from, trigger, to });
    });
  });

  describe('invalid transitions are rejected, not silently accepted', () => {
    it.each(INVALID)('%s --%s--> rejected', (from, trigger) => {
      const result = SubscriptionStateMachine.apply(from, trigger);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ name: 'InvalidTransition', from, trigger });
    });
  });

  it('treats canceled as terminal: no trigger moves it anywhere', () => {
    expect(SubscriptionStateMachine.isTerminal('canceled')).toBe(true);
    for (const trigger of ORACLE_TRIGGERS) {
      expect(SubscriptionStateMachine.apply('canceled', trigger).ok).toBe(false);
    }
  });

  it('only canceled is terminal', () => {
    const terminal = ORACLE_STATUSES.filter((s) => SubscriptionStateMachine.isTerminal(s));
    expect(terminal).toEqual(['canceled']);
  });

  it('returns immutable transitions so a caller cannot rewrite the target status', () => {
    const result = SubscriptionStateMachine.apply('trialing', 'TRIAL_CHARGE_SUCCEEDED');
    if (!result.ok) throw new Error('expected a valid transition');

    expect(Object.isFrozen(result.transition)).toBe(true);
  });

  it('cannot be bypassed by hand-building a Transition (enforced by `npm run typecheck`)', () => {
    // @ts-expect-error — a Transition literal is not assignable: only apply() issues one.
    const forged: Transition = { from: 'canceled', trigger: 'RETRY_SUCCEEDED', to: 'active' };
    expect(forged).toBeDefined();
  });
});
