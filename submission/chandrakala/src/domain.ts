export type Status = 'trialing' | 'active' | 'past_due' | 'canceled';
export type Trigger = 'paid' | 'failed' | 'cancel' | 'exhausted';
export type PlanName = 'basic' | 'pro';
export type PaymentStatus = 'succeeded' | 'failed' | 'refunded';
export type WebhookType = `payment.${PaymentStatus}`;

export class DomainError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const transitions: Record<Status, Partial<Record<Trigger, Status>>> = {
  trialing: { paid: 'active', failed: 'past_due', cancel: 'canceled' },
  active: { failed: 'past_due', cancel: 'canceled' },
  past_due: { paid: 'active', exhausted: 'canceled' },
  canceled: {},
};

export class SubscriptionLifecycle {
  next(state: Status, trigger: Trigger): Status {
    const next = transitions[state][trigger];
    if (!next) throw new DomainError(409, `Invalid transition: ${state} + ${trigger}`);
    return next;
  }
}

export const plans: Readonly<Record<PlanName, {price: number; trialDays: number}>> = {
  basic: { price: 1900, trialDays: 7 },
  pro: { price: 4900, trialDays: 0 },
};
export interface CreateSubscription {
  customer_id: string; plan: string; payment_method_id: string;
}
export interface Subscription {
  id: string; customer_id: string; payment_method_id: string; plan: PlanName;
  status: Status; trial_end: string; failures: number; created_at: string; updated_at: string;
}
export interface Invoice {
  id: string; subscription_id: string; sequence: number; amount: number; currency: 'USD';
  status: 'pending' | 'paid' | 'failed' | 'refunded'; created_at: string; updated_at: string;
}
export interface WebhookEvent {
  event_id: string; type: WebhookType; subscription_id: string;
  invoice_id: string; amount: number; currency: string;
}
export interface ChargeRequest {
  customerId: string; paymentMethodId: string; amount: number;
  currency: 'USD'; invoiceId: string; idempotencyKey: string;
}
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<'success' | 'decline'>;
}
export class ProviderTimeout extends Error {}
export interface Clock { now(): Date; }

export function isPlan(value: unknown): value is PlanName {
  return value === 'basic' || value === 'pro';
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
