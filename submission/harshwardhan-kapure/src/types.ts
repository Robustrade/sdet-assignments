export type PlanId = 'basic' | 'pro';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type SubscriptionTrigger =
  | 'TRIAL_SUCCEEDED'
  | 'TRIAL_FAILED'
  | 'RECURRING_FAILED'
  | 'RETRY_SUCCEEDED'
  | 'RETRIES_EXHAUSTED'
  | 'CANCEL';

export type ChargeOutcome = 'success' | 'declined' | 'timeout';

export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type InvoiceProviderOutcome = ChargeOutcome | 'webhook' | 'error' | null;

export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export type WebhookProcessingStatus = 'processed' | 'duplicate' | 'ignored';

export interface CustomerRecord {
  id: string;
  email: string;
  name: string;
  payment_methods: string[];
  created_at: string;
}

export interface SubscriptionRecord {
  id: string;
  customer_id: string;
  plan: PlanId;
  status: SubscriptionStatus;
  payment_method_id: string;
  trial_ends_at: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRecord {
  id: string;
  subscription_id: string;
  customer_id: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  provider_outcome: InvoiceProviderOutcome;
  idempotency_ref: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookEventRecord {
  id: string;
  event_id: string;
  type: string;
  subscription_id: string;
  invoice_id: string | null;
  processing_status: WebhookProcessingStatus;
  reason?: string;
  received_at: string;
}

export interface AuditLogRecord {
  id: string;
  subscription_id: string;
  from_status: SubscriptionStatus | null;
  to_status: SubscriptionStatus;
  trigger: string;
  created_at: string;
}

export interface CreateSubscriptionRequest {
  customer_id: string;
  plan: string;
  payment_method_id: string;
}

export interface WebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export interface IdempotencyRecord {
  key: string;
  request_fingerprint: string;
  status_code: number;
  response_body: SubscriptionRecord;
  created_at: string;
}
