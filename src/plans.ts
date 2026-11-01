export interface Plan {
  name: string;
  priceCents: number;
  currency: 'USD';
  trialDays: number; // 0 = charge immediately at signup
}

export const PLANS: Record<string, Plan> = {
  basic: { name: 'basic', priceCents: 1900, currency: 'USD', trialDays: 14 },
  pro: { name: 'pro', priceCents: 4900, currency: 'USD', trialDays: 0 },
};

export const DAY_MS = 24 * 60 * 60 * 1000;
