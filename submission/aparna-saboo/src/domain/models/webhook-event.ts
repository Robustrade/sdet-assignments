export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export interface WebhookEvent {
  eventId: string;
  subscriptionId: string;
  invoiceId: string;
  type: WebhookEventType;
  processedAt: string;
}
