import { describe, expect, it } from 'vitest';
import { PlanCatalog } from '../../src/domain/plans';
import { BILLING_PERIOD_DAYS, EXPECTED_PLANS, type PlanCode } from '../support/testData';
import { daysAfter } from '../support/time';

describe('PlanCatalog (unit)', () => {
  const catalog = new PlanCatalog();
  const start = new Date('2026-03-01T10:00:00.000Z');
  const plans = (Object.keys(EXPECTED_PLANS) as PlanCode[]).map((code) => ({ code, ...EXPECTED_PLANS[code] }));

  it.each(plans)('$code costs $priceCents cents with a $trialDays-day trial', ({ code, priceCents, currency, trialDays }) => {
    const plan = catalog.get(code);

    expect({ priceCents: plan.priceCents, currency: plan.currency, trialDays: plan.trialDays }).toEqual({
      priceCents,
      currency,
      trialDays,
    });
    expect(plan.trialEndsAt(start).toISOString()).toBe(daysAfter(start, trialDays));
    expect(plan.periodEndFrom(start).toISOString()).toBe(daysAfter(start, BILLING_PERIOD_DAYS));
  });

  it('charges on create only for a plan without a trial', () => {
    expect(catalog.get('basic').chargesOnCreate()).toBe(true);
    expect(catalog.get('pro').chargesOnCreate()).toBe(false);
  });

  it('does not know any other plan', () => {
    expect(catalog.find('enterprise')).toBeUndefined();
    expect(() => catalog.get('enterprise')).toThrow("Plan 'enterprise' is not configured");
  });
});
