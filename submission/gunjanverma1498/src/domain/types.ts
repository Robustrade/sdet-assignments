/**
 * Core domain entities for the Subscription & Billing Service.
 *
 * These shapes are the single source of truth for what gets persisted and what
 * the API returns. Keeping them in one place lets the test framework's
 * assertion layer and repositories share exactly the same contract as the
 * service under test.
 */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type InvoiceStatus = 'open' | 'paid' | 'failed' | 'refunded';

/** Events that can drive the subscription state machine. */
export type LifecycleEvent =
  | 'CHARGE_SUCCEEDED'
  | 'CHARGE_FAILED'
  | 'REFUND'
  | 'CANCEL';

/** Inbound webhook event types from the external payment provider. */
export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export interface Customer {
  id: string;
  email: string;
  /** Payment methods the service will accept for this customer. */
  paymentMethodIds: string[];
}

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  paymentMethodId: string;
  status: SubscriptionStatus;
  /** When the trial ends; null for plans that charge immediately. */
  trialEndAt: string | null;
  /** Number of consecutive failed billing attempts (drives retry exhaustion). */
  failedChargeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  /** Reference returned by the payment provider for a successful charge. */
  providerChargeId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Record of every inbound webhook we have accepted, keyed by the provider's
 * `event_id`. This table is what makes webhook processing idempotent: an
 * `event_id` already present here is a redelivery and must be a no-op.
 */
export interface WebhookEventRecord {
  eventId: string;
  type: WebhookEventType;
  subscriptionId: string;
  invoiceId: string | null;
  receivedAt: string;
}

/** Auditable, append-only history of everything that happened to a subscription. */
export interface AuditEvent {
  id: string;
  subscriptionId: string;
  type: string;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
