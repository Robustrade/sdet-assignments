export type PlanName = 'basic' | 'pro';

export interface Plan {
  name: PlanName;
  priceCents: number;
  trialDays: number;
  chargeImmediately: boolean;
}

export const PLANS: Record<PlanName, Plan> = {
  basic: {
    name: 'basic',
    priceCents: 1900,
    trialDays: 14,
    chargeImmediately: false,
  },

  pro: {
    name: 'pro',
    priceCents: 4900,
    trialDays: 7,
    chargeImmediately: false,
  },
};
