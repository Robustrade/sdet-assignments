export type WebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

export interface WebhookEvent {
  eventId: string;
  type: WebhookEventType;
  subscriptionId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  processedAt?: Date;
}