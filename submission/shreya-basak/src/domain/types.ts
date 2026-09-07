export type PlanId = 'basic' | 'pro';

export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled';

export type WebhookEventType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

export interface PlanConfig {
  id: PlanId;
  priceCents: number;
  trialDays: number;
  currency: string;
}

export interface Customer {
  id: string;
  paymentMethodId: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanId;
  paymentMethodId: string;
  state: SubscriptionState;
  createdAt: string;
  trialEndsAt: string | null;
  canceledAt: string | null;
  failedChargeCount: number;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: 'paid' | 'failed' | 'refunded';
  createdAt: string;
  providerChargeId: string | null;
}

export interface WebhookEventRecord {
  eventId: string;
  type: WebhookEventType;
  subscriptionId: string;
  invoiceId: string;
  receivedAt: string;
  processed: boolean;
  noop: boolean;
}

export interface AuditLogEntry {
  id: string;
  subscriptionId: string;
  timestamp: string;
  action: string;
  fromState: SubscriptionState | null;
  toState: SubscriptionState | null;
  detail: string;
}
