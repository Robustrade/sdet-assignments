export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled';

export type PlanId = 'basic' | 'pro';

export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
  | (string & {});

export type Trigger =
  | 'trial_ends_charge_succeeded'
  | 'trial_ends_charge_failed'
  | 'recurring_charge_failed'
  | 'retry_charge_succeeded'
  | 'retries_exhausted'
  | 'cancel';

export interface Plan {
  id: PlanId;
  name: string;
  price: number; // in minor units (cents)
  currency: string;
  trialDays: number;
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanId;
  state: SubscriptionState;
  paymentMethodId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  invoiceId: string;
  status: 'succeeded' | 'failed';
  amount: number;
  currency: string;
  providerRef: string;
  eventId: string;
  createdAt: string;
}

export interface WebhookEventRecord {
  eventId: string;
  subscriptionId: string;
  type: WebhookEventType;
  outcome: string;
  processedAt: string;
}

export interface CreateSubscriptionRequest {
  customerId: string | undefined;
  plan: PlanId | undefined;
  paymentMethodId: string | undefined;
}

export interface InboundWebhook {
  eventId: string;
  type: WebhookEventType;
  subscriptionId: string;
  invoiceId: string;
  amount: number;
  currency: string;
}