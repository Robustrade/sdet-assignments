/**
 * Domain Types & Interfaces
 */

export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Plan {
  id: string;
  name: string;
  price: number; // cents
  currency: string;
  trialLengthDays: number;
  billingCycleDays: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  state: SubscriptionState;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd?: Date;
  canceledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed';
  eventType: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  createdAt: Date;
}

export interface WebhookEvent {
  id: string;
  eventId: string; // Unique event ID from payment provider
  type: string;
  subscriptionId: string;
  payload: Record<string, unknown>;
  processed: boolean;
  processedAt?: Date;
  createdAt: Date;
}

export interface PaymentProvider {
  charge(
    customerId: string,
    amount: number,
    idempotencyKey: string
  ): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }>;
}

export interface CreateSubscriptionRequest {
  customer_id: string;
  plan: string;
  payment_method_id: string;
}

export interface SubscriptionResponse {
  id: string;
  customer_id: string;
  plan: string;
  state: SubscriptionState;
  current_period_start: string; // ISO date
  current_period_end: string;
  trial_end?: string;
  canceled_at?: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookPayload {
  event_id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  subscription_id: string;
  invoice_id?: string;
  amount: number;
  currency: string;
}

export interface WebhookRequest {
  body: WebhookPayload;
  signature: string; // X-Provider-Signature header
}
