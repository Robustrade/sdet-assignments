import { describe, expect, it } from 'vitest';
import { getPlan } from '../src/plans/plan-registry';

describe('Plan registry', () => {
  it.each([
    { name: 'basic', price: 1900, trialDays: 7 },
    { name: 'pro', price: 4900, trialDays: 14 },
  ])('provides the price and trial length for $name', (plan) => {
    expect(getPlan(plan.name)).toEqual(plan);
  });

  it.each(['unknown', 'toString', '__proto__', '', null, 1900])(
    'rejects unsupported plan %s',
    (name) => {
      expect(getPlan(name)).toBeUndefined();
    },
  );
});
