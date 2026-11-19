/**
 * Domain types shared by the service fixture and the test suite.
 *
 * Status unions are closed string-literal types: the compiler rejects any value
 * outside the list, which is TypeScript's lightweight equivalent of a Java enum.
 */

/** Requirement: exactly these four subscription states - never a fifth. */
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** A provider timeout is a payment-attempt outcome (`timed_out`), not a subscription state. */
export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'timed_out', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const INVOICE_STATUSES = ['open', 'paid', 'void', 'refunded'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const WEBHOOK_PROCESSING_STATUSES = ['processed', 'ignored', 'quarantined'] as const;
export type WebhookProcessingStatus = (typeof WEBHOOK_PROCESSING_STATUSES)[number];

export const WEBHOOK_EVENT_TYPES = ['payment.succeeded', 'payment.failed', 'payment.refunded'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** What caused a subscription state change - stored in the audit history. */
export type AuditTrigger =
  | 'api_create'
  | 'api_cancel'
  | 'billing_charge'
  | 'retries_exhausted'
  | 'webhook';

export interface Customer {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  priceMinor: number;
  currency: string;
  /** 0 means "charge immediately" (zero-length trial, assumption A-01). */
  trialDays: number;
  billingIntervalDays: number;
}

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  paymentMethodId: string;
  status: SubscriptionStatus;
  trialEnd: string;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
  canceledAt: string | null;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountMinor: number;
  currency: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  updatedAt: string;
}

/** One row per outbound charge attempt. */
export interface Payment {
  id: string;
  invoiceId: string;
  subscriptionId: string;
  attemptNumber: number;
  idempotencyKey: string;
  providerReference: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  subscriptionId: string;
  invoiceId: string;
  providerReference: string | null;
  payload: string;
  processingStatus: WebhookProcessingStatus;
  ignoreReason: string | null;
  matchedPaymentId: string | null;
  deliveryCount: number;
  firstReceivedAt: string;
  lastReceivedAt: string;
}

export interface SubscriptionEvent {
  id: string;
  subscriptionId: string;
  sequence: number;
  previousStatus: SubscriptionStatus | null;
  newStatus: SubscriptionStatus;
  trigger: AuditTrigger;
  referenceId: string | null;
  createdAt: string;
}

export interface IdempotencyKeyRecord {
  key: string;
  requestHash: string;
  subscriptionId: string;
  createdAt: string;
}
