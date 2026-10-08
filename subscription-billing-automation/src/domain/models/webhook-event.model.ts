export type PaymentWebhookType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

export interface WebhookPayload {
  event_id: string;
  type: PaymentWebhookType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  retries_exhausted?: boolean;
}

export interface WebhookEventRecord {
  eventId: string;
  subscriptionId: string;
  type: PaymentWebhookType;
  receivedAt: string;
  deliveryCount: number;
  outcome: 'applied' | 'ignored';
}
