import type { Plan } from './types.js';

export const PLANS: readonly Plan[] = [
  {
    id: 'basic',
    name: 'Basic',
    price: 1900,
    currency: 'USD',
    trialDays: 7,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 4900,
    currency: 'USD',
    trialDays: 0,
  },
];