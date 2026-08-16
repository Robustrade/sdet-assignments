export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type PaymentStatus = "succeeded" | "failed";

export type WebhookType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

export interface Plan {
  name: "basic" | "pro";
  price: number;
  trialDays: number;
}

export interface Customer {
  id: string;
  paymentMethodId: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: Plan["name"];
  paymentMethodId: string;
  status: SubscriptionStatus;
}

export interface Payment {
  id: string;
  subscriptionId: string;
  invoiceId: string;
  amount: number;
  status: PaymentStatus;
  reference: string;
}

export interface WebhookEvent {
  eventId: string;
  type: WebhookType;
  subscriptionId: string;
  invoiceId: string;
  amount: number;
  currency: string;
}

export interface AuditEvent {
  id: string;
  subscriptionId: string;
  type: string;
  fromStatus?: SubscriptionStatus;
  toStatus?: SubscriptionStatus;
  eventId?: string;
}
