export interface PlanConfig {
  name: 'basic' | 'pro';
  price: number; // in cents
  currency: string;
  trialDays: number;
}

export const PLANS: Record<string, PlanConfig> = {
  basic: { name: 'basic', price: 1500, currency: 'USD', trialDays: 7 },
  pro: { name: 'pro', price: 4900, currency: 'USD', trialDays: 14 },
};  