
export type WebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

export interface WebhookEvent {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}
export type WebhookAuditOutcome =
  | "processed"
  | "duplicate"
  | "ignored";

export interface WebhookAuditRecord {
  eventId: string;
  eventType: WebhookEventType;
  subscriptionId: string;
  invoiceId: string;
  outcome: WebhookAuditOutcome;
  processedAt: Date;
}
