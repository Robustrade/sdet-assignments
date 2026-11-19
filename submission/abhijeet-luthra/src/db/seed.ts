import { Repositories } from '../repositories';

/**
 * Reference data for the fixture. Prices and trial lengths are ILLUSTRATIVE test
 * data (design §16), not real Kulu pricing. `pro` = 4900 matches the assignment's
 * example webhook amount.
 */
export const SEED_PLANS = {
  basic: { id: 'basic', priceMinor: 1900, currency: 'USD', trialDays: 0, billingIntervalDays: 30 },
  pro: { id: 'pro', priceMinor: 4900, currency: 'USD', trialDays: 7, billingIntervalDays: 30 },
} as const;

export const SEED_CUSTOMERS = {
  cust_001: { id: 'cust_001', name: 'Ada Customer', email: 'ada@example.test' },
  cust_002: { id: 'cust_002', name: 'Grace Customer', email: 'grace@example.test' },
} as const;

export function seedReferenceData(repos: Repositories, nowIso: string): void {
  for (const plan of Object.values(SEED_PLANS)) repos.plans.insert({ ...plan });
  for (const customer of Object.values(SEED_CUSTOMERS)) repos.customers.insert({ ...customer, createdAt: nowIso });
}
