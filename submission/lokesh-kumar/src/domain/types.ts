import type { SubscriptionState } from './SubscriptionStateMachine.js';

export type { SubscriptionState };
export type PlanId = 'basic' | 'pro';
export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanId;
  paymentMethodId: string;
  status: SubscriptionState;
  /** Consecutive failed charges since the last successful one. */
  failedAttempts: number;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  failureReason: string | null;
  providerChargeId: string | null;
  /** Reference sent to the payment provider so a retried call cannot double charge. */
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** Set when a payment was actually collected (stays set after a refund). */
  paidAt: string | null;
}

export type WebhookOutcome =
  | 'applied'
  | 'ignored_canceled'
  | 'ignored_stale'
  | 'ignored_invalid_transition';

export interface WebhookEventRecord {
  eventId: string;
  type: string;
  subscriptionId: string;
  invoiceId: string;
  outcome: WebhookOutcome;
  /** 1 for the first delivery, incremented for every redelivery of the same event_id. */
  deliveryCount: number;
  receivedAt: string;
}

export interface AuditEntry {
  subscriptionId: string;
  from: SubscriptionState | null;
  to: SubscriptionState;
  trigger: string;
  at: string;
}
