export type SubscriptionState = "trialing" | "active" | "past_due" | "canceled";

export type PlanId = "basic" | "pro";

export interface PlanConfig {
  id: PlanId;
  priceCents: number;
  currency: string;
  trialDays: number;
  maxPaymentRetries: number;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  basic: { id: "basic", priceCents: 1900, currency: "USD", trialDays: 0, maxPaymentRetries: 2 },
  pro: { id: "pro", priceCents: 4900, currency: "USD", trialDays: 14, maxPaymentRetries: 2 },
};

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanId;
  paymentMethodId: string;
  status: SubscriptionState;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = "pending" | "paid" | "failed" | "refunded";

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  createdAt: string;
  updatedAt: string;
}

export type WebhookEventType = "payment.succeeded" | "payment.failed" | "payment.refunded";

export interface WebhookEventPayload {
  eventId: string;
  type: WebhookEventType;
  subscriptionId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
}

export interface AuditEvent {
  id: string;
  subscriptionId: string;
  eventType: string;
  detail: string;
  createdAt: string;
}
