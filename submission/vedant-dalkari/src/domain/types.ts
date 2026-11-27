/**
 * Core domain types, entity snapshots, and branded transition tokens.
 * Author: Vedant Dalkari
 */

export type PlanCode = 'starter' | 'growth';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type PaymentAttemptStatus = 'succeeded' | 'declined' | 'timeout';

export type WebhookEventType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

export type WebhookOutcome = 'processed' | 'ignored_invalid_transition' | 'ignored_stale';

export type TransitionTrigger =
  | 'signup_trial'
  | 'signup_charge_succeeded'
  | 'signup_charge_failed'
  | 'trial_charge_succeeded'
  | 'trial_charge_failed'
  | 'renewal_charge_failed'
  | 'retry_charge_succeeded'
  | 'retries_exhausted'
  | 'api_cancel'
  | 'payment_succeeded_webhook'
  | 'payment_failed_webhook'
  | 'payment_refunded_webhook';

export type TransitionActor = 'api' | 'scheduler' | 'webhook';

declare const APPROVED_TRANSITION_BRAND: unique symbol;

/**
 * Branded transition token produced exclusively by LifecycleEngine.transition().
 * SubscriptionRepo.commitTransition requires this token so raw status strings
 * or unvalidated object literals fail TypeScript compilation.
 */
export interface ApprovedTransition {
  readonly [APPROVED_TRANSITION_BRAND]: true;
  readonly fromStatus: SubscriptionStatus | null;
  readonly toStatus: SubscriptionStatus;
  readonly trigger: TransitionTrigger;
}

export interface CustomerRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly created_at: string;
}

export interface SubscriptionSnapshot {
  readonly id: string;
  readonly customer_id: string;
  readonly plan: PlanCode;
  readonly status: SubscriptionStatus;
  readonly current_period_start: string;
  readonly current_period_end: string;
  readonly trial_ends_at: string | null;
  readonly failed_attempts: number;
  readonly canceled_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SubscriptionRecord extends SubscriptionSnapshot {
  readonly payment_method_id: string;
}

export interface InvoiceRecord {
  readonly id: string;
  readonly subscription_id: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly period_start: string;
  readonly period_end: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PaymentAttemptRecord {
  readonly id: string;
  readonly invoice_id: string;
  readonly subscription_id: string;
  readonly idempotency_key: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status: PaymentAttemptStatus;
  readonly provider_reference: string | null;
  readonly failure_reason: string | null;
  readonly created_at: string;
}

export interface WebhookEventRecord {
  readonly event_id: string;
  readonly event_type: WebhookEventType;
  readonly subscription_id: string | null;
  readonly invoice_id: string | null;
  readonly outcome: WebhookOutcome;
  readonly payload_hash: string;
  readonly received_at: string;
}

export interface SubscriptionAuditRecord {
  readonly id: string;
  readonly subscription_id: string;
  readonly from_status: SubscriptionStatus | null;
  readonly to_status: SubscriptionStatus;
  readonly trigger: string;
  readonly actor: TransitionActor;
  readonly metadata_json: string;
  readonly created_at: string;
}
