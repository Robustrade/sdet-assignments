export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type CurrencyCode = 'USD' | 'EUR' | 'GBP';
export type PlanName = 'basic' | 'pro';

export interface Plan {
  name: PlanName;
  price: number;
  currency: CurrencyCode;
  trialLengthDays: number;
  chargesImmediately: boolean;
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanName;
  status: SubscriptionStatus;
  createdAt: string;
  updatedAt: string;
}
