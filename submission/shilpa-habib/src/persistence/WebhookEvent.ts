export type WebhookEventType = | "payment.succeeded" | "payment.failed" | "payment.refunded";

export interface WebhookEvent { eventId: string; type: WebhookEventType; subscriptionId: string; invoiceId: string; receivedAt: string; processed: boolean; duplicate: boolean; ignoredReason: string | null; }