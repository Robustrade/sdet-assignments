import type { Plan, PlanName } from './subscription';

export const PLAN_CATALOG: Record<PlanName, Plan> = {
  basic: {
    name: 'basic',
    price: 2900,
    currency: 'USD',
    trialLengthDays: 14,
    chargesImmediately: false,
  },
  pro: {
    name: 'pro',
    price: 4900,
    currency: 'USD',
    trialLengthDays: 14,
    chargesImmediately: true,
  },
};
