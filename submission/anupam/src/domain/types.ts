export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
export type PlanId = 'basic' | 'pro';
export type Currency = 'USD';

export interface Customer {
  id: string;
  email: string;
  paymentMethodIds: string[];
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanId;
  paymentMethodId: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** Failed charges in the current dunning cycle. Reset on success. */
  failedAttempts: number;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency version; bumped on every write. */
  version: number;
}

export type InvoiceStatus = 'open' | 'paid' | 'failed' | 'refunded';

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number; // minor units (cents)
  currency: Currency;
  status: InvoiceStatus;
  attemptCount: number;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';
export type PaymentSource = 'provider_call' | 'webhook';

/** One row per billing attempt result (plus refunds). */
export interface Payment {
  id: string;
  invoiceId: string;
  subscriptionId: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  attempt: number | null;
  idempotencyKey: string | null;
  providerReference: string | null;
  source: PaymentSource;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WebhookEventType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
export type WebhookOutcome = 'processing' | 'processed' | 'ignored';

/** Tracks every provider event_id ever seen - the idempotency ledger. */
export interface WebhookEventRecord {
  eventId: string;
  type: WebhookEventType;
  subscriptionId: string;
  invoiceId: string;
  outcome: WebhookOutcome;
  reason: string | null;
  deliveryCount: number;
  firstReceivedAt: string;
  lastReceivedAt: string;
}

export interface AuditEntry {
  seq: number;
  subscriptionId: string;
  action: string;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus | null;
  detail: string | null;
  at: string;
}
