import { Subscription } from '../domain/types';

/** API representation (API_CONTRACTS §2): snake_case, plan id exposed as `plan`. */
export interface SubscriptionResponse {
  id: string;
  customer_id: string;
  plan: string;
  status: Subscription['status'];
  trial_end: string;
  current_period_end: string | null;
  created_at: string;
  canceled_at: string | null;
}

export function presentSubscription(s: Subscription): SubscriptionResponse {
  return {
    id: s.id,
    customer_id: s.customerId,
    plan: s.planId,
    status: s.status,
    trial_end: s.trialEnd,
    current_period_end: s.currentPeriodEnd,
    created_at: s.createdAt,
    canceled_at: s.canceledAt,
  };
}
