import type { PlanId } from './types.js';

export interface PlanConfig {
  id: PlanId;
  priceCents: number;
  currency: 'USD';
  /** 0 means the first charge happens immediately at creation. */
  trialDays: number;
}

export const PLANS: Readonly<Record<PlanId, PlanConfig>> = {
  basic: { id: 'basic', priceCents: 1900, currency: 'USD', trialDays: 0 },
  pro: { id: 'pro', priceCents: 4900, currency: 'USD', trialDays: 14 },
};

export function findPlan(id: string): PlanConfig | undefined {
  return Object.hasOwn(PLANS, id) ? PLANS[id as PlanId] : undefined;
}
