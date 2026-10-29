export const WEBHOOK_EVENT_TYPES = ['payment.succeeded', 'payment.failed', 'payment.refunded'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** The validated body of an inbound provider webhook. */
export interface PaymentWebhookEvent {
  readonly eventId: string;
  readonly type: WebhookEventType;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly amount: number;
  readonly currency: string;
}

export type WebhookOutcome = 'processed' | 'ignored';

/** What we remember about an event id: enough to answer a redelivery without touching anything else. */
export interface WebhookEventRecord {
  readonly eventId: string;
  readonly type: WebhookEventType;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly outcome: WebhookOutcome;
  /** Why an event was ignored (absent when processed). */
  readonly reason?: string;
  /** 1 for the first delivery; every redelivery adds one and changes nothing else. */
  readonly deliveryCount: number;
  readonly receivedAt: string;
  readonly lastDeliveredAt: string;
}
