
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function createSubscription(
  id: string,
  customerId: string,
  planId: string,
  status: SubscriptionStatus = 'trialing'
): Subscription {
  if (!id.trim()) {
    throw new Error('Subscription ID is required');
  }

  if (!customerId.trim()) {
    throw new Error('Customer ID is required');
  }

  if (!planId.trim()) {
    throw new Error('Plan ID is required');
  }

  return {
    id,
    customerId,
    planId,
    status,
    cancelAtPeriodEnd: false
  };
}
