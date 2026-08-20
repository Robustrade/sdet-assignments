export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Plan {
  id: string;
  priceCents: number;
  trialDays: number;
}

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  paymentMethodId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  /** Correlates to the payment provider's invoice_id when created from a webhook. */
  invoiceRef: string;
  amountCents: number;
  currency: string;
  status: 'succeeded' | 'failed';
  createdAt: string;
}

export interface WebhookEventRecord {
  eventId: string;
  type: string;
  subscriptionId: string;
  processedAt: string;
}

export type WebhookEventType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

export interface InboundWebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}
