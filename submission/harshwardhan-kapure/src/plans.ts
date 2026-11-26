import { PlanId } from './types';

export interface PlanStrategy {
  readonly id: PlanId;
  readonly name: string;
  readonly priceCents: number;
  readonly currency: 'USD';
  readonly trialDays: number;
  shouldChargeOnCreation(): boolean;
  getTrialEndsAt(from: Date): string | null;
}

const MS_PER_DAY = 86_400_000;

function createPlanStrategy(config: {
  id: PlanId;
  name: string;
  priceCents: number;
  trialDays: number;
}): PlanStrategy {
  return {
    id: config.id,
    name: config.name,
    priceCents: config.priceCents,
    currency: 'USD',
    trialDays: config.trialDays,
    shouldChargeOnCreation: () => config.trialDays === 0,
    getTrialEndsAt: (from: Date) =>
      config.trialDays > 0 ? new Date(from.getTime() + config.trialDays * MS_PER_DAY).toISOString() : null
  };
}

/**
 * Plan pricing and trial policies indexed by plan identifier (Strategy registry).
 */
export const PLANS: Readonly<Record<PlanId, PlanStrategy>> = Object.freeze({
  basic: createPlanStrategy({
    id: 'basic',
    name: 'Basic',
    priceCents: 1900,
    trialDays: 0
  }),
  pro: createPlanStrategy({
    id: 'pro',
    name: 'Pro',
    priceCents: 4900,
    trialDays: 14
  })
});

export function getPlanStrategy(planId: string): PlanStrategy | undefined {
  if (!Object.prototype.hasOwnProperty.call(PLANS, planId)) {
    return undefined;
  }
  return PLANS[planId as PlanId];
}
