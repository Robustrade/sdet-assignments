
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export type SubscriptionEvent =
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'RETRY_SUCCEEDED'
  | 'RETRIES_EXHAUSTED'
  | 'CUSTOMER_CANCELED';
