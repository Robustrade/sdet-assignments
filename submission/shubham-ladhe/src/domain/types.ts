export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = ['open', 'paid', 'uncollectible', 'void', 'refunded'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const ATTEMPT_STATUSES = ['pending', 'succeeded', 'declined', 'unknown'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const PLAN_CODES = ['basic', 'pro'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const WEBHOOK_EVENT_TYPES = ['payment.succeeded', 'payment.failed', 'payment.refunded'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Where a change originated. Recorded on every audit entry. */
export type ChangeSource = 'api' | 'webhook' | 'billing';

export const CURRENCY = 'USD';

export interface Customer {
  id: string;
  email: string;
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  customerId: string;
  brand: string;
  last4: string;
  status: 'active' | 'expired';
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanCode;
  status: SubscriptionStatus;
  paymentMethodId: string;
  priceCents: number;
  currency: string;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  canceledAt: string | null;
  cancelReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  failedAttempts: number;
  nextRetryAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChargeAttempt {
  id: string;
  invoiceId: string;
  attemptNo: number;
  idempotencyKey: string;
  amountCents: number;
  status: AttemptStatus;
  providerChargeId: string | null;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

export type WebhookOutcome = 'processed' | 'ignored';

export interface WebhookEventRecord {
  eventId: string;
  type: WebhookEventType;
  subscriptionId: string;
  invoiceId: string;
  payload: string;
  outcome: WebhookOutcome;
  reason: string | null;
  receivedAt: string;
}

export interface AuditEntry {
  id: number;
  subscriptionId: string;
  seq: number;
  action: string;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus | null;
  source: ChangeSource;
  reference: string | null;
  at: string;
  prevHash: string;
  hash: string;
}

export interface Notification {
  id: number;
  subscriptionId: string;
  kind: string;
  reference: string;
  createdAt: string;
}
