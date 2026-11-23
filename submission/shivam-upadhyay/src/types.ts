export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'canceled';

export type PlanId = 'basic' | 'pro';

export interface Plan {
  id: PlanId;
  priceCents: number;
  trialDays: number;
}

export const PLANS: Record<PlanId, Plan> = {
  basic: { id: 'basic', priceCents: 1900, trialDays: 14 },
  pro: { id: 'pro', priceCents: 4900, trialDays: 7 },
};

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanId;
  paymentMethodId: string;
  state: SubscriptionState;
  trialEndsAt: number;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

export type InvoiceStatus = 'paid' | 'failed' | 'refunded';

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  /** Charge idempotency key (direct charges) or webhook invoice id. */
  reference: string;
  createdAt: number;
}

export type WebhookType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

export interface WebhookEventRecord {
  eventId: string;
  type: WebhookType;
  subscriptionId: string;
  invoiceId?: string;
  receivedAt: number;
  /** True once the event has been applied (or deliberately ignored). */
  processed: boolean;
}

export interface AuditEvent {
  subscriptionId: string;
  kind: string;
  from: SubscriptionState | null;
  to: SubscriptionState | null;
  at: number;
  detail?: string;
}
