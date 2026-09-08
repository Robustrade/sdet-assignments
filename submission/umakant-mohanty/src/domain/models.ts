export type PlanCode = 'basic' | 'pro';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
export type PaymentOutcome = 'success' | 'decline' | 'timeout';
export type PaymentEventType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

export interface Plan {
  code: PlanCode;
  priceCents: number;
  trialDays: number;
}

export interface Customer {
  id: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanCode;
  paymentMethodId: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'refunded';
  providerReference: string | null;
  createdAt: string;
}

export interface WebhookEvent {
  eventId: string;
  type: PaymentEventType;
  subscriptionId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  processed: boolean;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  subscriptionId: string;
  event: string;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  referenceId: string | null;
  createdAt: string;
}

export interface CreateSubscriptionRequest {
  customerId: string;
  plan: PlanCode;
  paymentMethodId: string;
}

export interface ProviderChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  reference: string;
}
