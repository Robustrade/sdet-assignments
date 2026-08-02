export const PLANS = {
  basic: { price: 1000, trialDays: 7 },
  pro: { price: 4900, trialDays: 14 },
  no_trial: { price: 5000, trialDays: 0 }
};

export type PlanTier = keyof typeof PLANS;

export function isValidPlan(plan: string): plan is PlanTier {
  return plan in PLANS;
}
