import { PlanCatalog } from '../../../src/domain/plans';
import { UnknownPlanError } from '../../../src/domain/errors';

describe('PlanCatalog / plan strategies (unit)', () => {
  const catalog = new PlanCatalog();

  it.each([
    ['basic', 1900, 14, 2],
    ['pro', 4900, 0, 3],
  ])('%s: price=%i trialDays=%i maxRetries=%i', (id, price, trial, retries) => {
    const plan = catalog.get(id);
    expect(plan).toMatchObject({ priceCents: price, trialDays: trial, maxPaymentRetries: retries, currency: 'USD' });
  });

  it('computes trial end from the plan, not from the caller', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(catalog.get('basic').trialEndsAt(start).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(catalog.get('pro').trialEndsAt(start).toISOString()).toBe(start.toISOString());
  });

  it('retry budget is plan specific', () => {
    expect(catalog.get('basic').isRetryBudgetExhausted(3)).toBe(true);
    expect(catalog.get('pro').isRetryBudgetExhausted(3)).toBe(false);
    expect(catalog.get('pro').isRetryBudgetExhausted(4)).toBe(true);
  });

  it('unknown plan throws a typed error', () => {
    expect(() => catalog.get('enterprise')).toThrow(UnknownPlanError);
  });
});
