export type WebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

export interface WebhookEvent {
  eventId: string;
  type: WebhookEventType;
  processed: boolean;
  receivedAt: Date;
  processedAt?: Date;
}