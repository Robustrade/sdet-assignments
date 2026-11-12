/**
 * Expected business rules, written out here on purpose instead of imported from src/.
 * If the service had a wrong price or trial length, reusing its own values would hide the bug.
 */
export const EXPECTED_PLANS = {
  basic: { priceCents: 1900, currency: 'USD', trialDays: 0 },
  pro: { priceCents: 4900, currency: 'USD', trialDays: 14 },
} as const;

export type PlanCode = keyof typeof EXPECTED_PLANS;

export const BILLING_PERIOD_DAYS = 30;
export const MAX_FAILED_ATTEMPTS = 3;

export const WEBHOOK_SECRET = 'whsec_test_only_secret';

export interface CustomerRef {
  readonly id: string;
  readonly paymentMethodId: string;
}

/** Seeded into every test database. */
export const CUSTOMER_1: CustomerRef = { id: 'cust_001', paymentMethodId: 'pm_test_visa_4242' };
export const CUSTOMER_2: CustomerRef = { id: 'cust_002', paymentMethodId: 'pm_test_mc_5555' };
