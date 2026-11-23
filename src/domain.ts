export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";
export type PlanId = "basic" | "pro";

export interface Plan {
  id: PlanId;
  price: number;
  currency: "USD";
  trialDays: number;
  initialStatus: "trialing" | "active";
}

export const PLANS: Record<PlanId, Plan> = {
  basic: { id: "basic", price: 1000, currency: "USD", trialDays: 7, initialStatus: "trialing" },
  pro: { id: "pro", price: 4900, currency: "USD", trialDays: 14, initialStatus: "trialing" }
};

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanId;
  paymentMethodId: string;
  status: SubscriptionStatus;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: "USD";
  status: "pending" | "succeeded" | "failed" | "refunded";
  providerReference: string;
  createdAt: string;
}

export interface WebhookEvent {
  eventId: string;
  type: "payment.succeeded" | "payment.failed" | "payment.refunded";
  subscriptionId: string;
  invoiceId: string;
  processed: boolean;
  receivedAt: string;
}

export interface AuditRecord {
  id: number;
  subscriptionId: string;
  fromStatus: SubscriptionStatus;
  toStatus: SubscriptionStatus;
  trigger: string;
  createdAt: string;
}
