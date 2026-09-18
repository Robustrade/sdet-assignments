import type { ChangeSource, SubscriptionState, WebhookEventType } from '../domain/types';

export interface CustomerRecord {
  id: string;
  email: string;
  payment_method_ids: string[];
  created_at: string;
}

export interface SubscriptionRecord {
  id: string;
  customer_id: string;
  plan: string;
  state: SubscriptionState;
  payment_method_id: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  retries_remaining: number;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
}

export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'void';

export interface InvoiceRecord {
  id: string;
  subscription_id: string;
  customer_id: string;
  plan: string;
  amount_cents: number;
  currency: string;
  status: InvoiceStatus;
  /** 1-based billing attempt counter within the subscription. */
  attempt: number;
  idempotency_key: string;
  provider_charge_id: string | null;
  failure_code: string | null;
  /** Set once, when the charge actually succeeded. A later refund never clears it. */
  paid_at: string | null;
  refunded_at: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  updated_at: string;
}

export type WebhookOutcome = 'processed' | 'ignored';

export interface WebhookEventRecord {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string | null;
  amount_cents: number | null;
  outcome: WebhookOutcome;
  reason: string | null;
  state_before: SubscriptionState;
  state_after: SubscriptionState;
  received_at: string;
  /** Incremented on every redelivery, so no-op'd duplicates remain auditable. */
  delivery_count: number;
  last_delivered_at: string;
}

export interface SubscriptionEventRecord {
  id: string;
  subscription_id: string;
  seq: number;
  kind: 'transition' | 'note';
  transition_id: string | null;
  trigger: string | null;
  from_state: SubscriptionState | null;
  to_state: SubscriptionState | null;
  note: string | null;
  source: ChangeSource;
  invoice_id: string | null;
  event_id: string | null;
  occurred_at: string;
}
