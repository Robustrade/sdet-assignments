/**
 * Domain Types for Subscription & Billing Service
 */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type WebhookEventType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

export type InvoiceStatus = 'pending' | 'paid' | 'failed';

export type PlanType = 'basic' | 'pro';

export interface Subscription {
  id: string;
  customer_id: string;
  plan: PlanType;
  status: SubscriptionStatus;
  payment_method_id: string;
  created_at: Date;
  trial_end_at?: Date;
  canceled_at?: Date;
}

export interface Invoice {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  attempt_count: number;
  created_at: Date;
  paid_at?: Date;
}

export interface WebhookEvent {
  id?: number;
  event_id: string; // Idempotency key
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount?: number;
  currency?: string;
  processed_at: Date;
  is_duplicate: boolean;
}

export interface StateTransition {
  id?: number;
  subscription_id: string;
  from_status: SubscriptionStatus;
  to_status: SubscriptionStatus;
  trigger: 'api_call' | 'webhook';
  trigger_detail?: string;
  transitioned_at: Date;
}

export interface PlanConfig {
  name: PlanType;
  price: number;
  currency: string;
  trial_days: number;
  billing_interval: 'month' | 'year';
}

export const PLANS: Record<PlanType, PlanConfig> = {
  basic: {
    name: 'basic',
    price: 2900,
    currency: 'USD',
    trial_days: 7,
    billing_interval: 'month',
  },
  pro: {
    name: 'pro',
    price: 4900,
    currency: 'USD',
    trial_days: 14,
    billing_interval: 'month',
  },
};

export interface CreateSubscriptionRequest {
  customer_id: string;
  plan: PlanType;
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

export interface ChargeResult {
  success: boolean;
  chargeId?: string;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}
