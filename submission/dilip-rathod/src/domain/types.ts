import type { SubscriptionStatus } from './SubscriptionStateMachine';

export interface Customer {
  id: string;
  email: string;
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  customerId: string;
  createdAt: string;
}

export type CancelReason = 'customer_request' | 'retries_exhausted';

export interface Subscription {
  id: string;
  customerId: string;
  paymentMethodId: string;
  plan: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  retryCount: number;
  canceledAt: string | null;
  cancelReason: CancelReason | null;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = 'open' | 'paid' | 'uncollectible' | 'void' | 'refunded';

export interface Invoice {
  id: string;
  subscriptionId: string;
  plan: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  paidAt: string | null;
  closedAt: string | null;
}

export type AttemptStatus = 'pending' | 'succeeded' | 'declined' | 'timed_out';
export type OutcomeSource = 'provider_response' | 'webhook';

export interface PaymentAttempt {
  id: string;
  invoiceId: string;
  attemptNumber: number;
  idempotencyKey: string;
  amount: number;
  status: AttemptStatus;
  providerChargeId: string | null;
  declineCode: string | null;
  resolvedBy: OutcomeSource | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type AuditEventType =
  | 'created'
  | 'status_changed'
  | 'renewed'
  | 'retry_failed'
  | 'plan_changed'
  | 'invoice_refunded';

export type NotificationKind =
  | 'subscription_activated'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'payment_refunded';

/** Result of applying an external signal (provider response or webhook) to the billing state. */
export type OutcomeResult = { applied: true } | { applied: false; reason: string };

export const applied: OutcomeResult = { applied: true };
export const ignored = (reason: string): OutcomeResult => ({ applied: false, reason });
