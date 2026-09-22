import { PlanConfig } from './plan';

const plans: Record<PlanConfig['name'], PlanConfig> = {
  basic: Object.freeze({ name: 'basic', price: 1900, trialDays: 7 }),
  pro: Object.freeze({ name: 'pro', price: 4900, trialDays: 14 }),
};

export function getPlan(name: unknown): PlanConfig | undefined {
  if (typeof name !== 'string' || !Object.hasOwn(plans, name)) {
    return undefined;
  }

  return plans[name as PlanConfig['name']];
}
