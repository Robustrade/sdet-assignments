
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export type PlanType = 'basic' | 'pro';

export interface Subscription {
  id: string;
  customer_id: string;
  plan: PlanType;
  status: SubscriptionStatus;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
}

export interface CreateSubscriptionInput {
  customer_id: string;
  plan: PlanType;
}
