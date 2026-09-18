/** The only states a subscription may ever occupy. */
export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled';

export const SUBSCRIPTION_STATES: readonly SubscriptionState[] = [
  'trialing',
  'active',
  'past_due',
  'canceled'
] as const;

export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  'payment.succeeded',
  'payment.failed',
  'payment.refunded'
] as const;

/** Where a state change originated. Recorded on every audit row. */
export type ChangeSource = 'api' | 'webhook' | 'billing_runner' | 'system';
