import { BasicPlan, ProPlan } from '../../src/domain/plans';
import { addDays } from '../../src/domain/time';
import { TEST_EPOCH } from './doubles/FakeClock';

export { TEST_EPOCH };

export const WEBHOOK_SECRET = 'whsec_test_only_not_a_real_secret';

/** Reference data every test starts with. */
export const SEED = {
  alice: { customerId: 'cust_001', card: 'pm_test_visa_4242' },
  bob: { customerId: 'cust_002', card: 'pm_test_mc_5454', expiredCard: 'pm_test_expired_0341' },
} as const;

/** Plan rules as configured in the service, so specs say "the basic trial" instead of "14". */
export const PLANS = { basic: new BasicPlan(), pro: new ProPlan() } as const;
export const BILLING_PERIOD_DAYS = PLANS.basic.billingPeriodDays;

/** An ISO timestamp `days` after the moment every test starts at. */
export function daysAfterStart(days: number): string {
  return addDays(TEST_EPOCH, days);
}

export function oneMinuteBefore(iso: string): string {
  return new Date(Date.parse(iso) - 60_000).toISOString();
}
