export type Status = 'trialing' | 'active' | 'past_due' | 'canceled';
export type Trigger = 'charge_success' | 'charge_failure' | 'retry_exhausted' | 'cancel';
export type Plan = 'basic' | 'pro';
export interface PlanConfig { price: number; trialDays: number }
export const PLANS: Record<Plan, PlanConfig> = {
  basic: { price: 1900, trialDays: 7 },
  pro: { price: 4900, trialDays: 14 }
};
export interface Subscription {
  id: string; customerId: string; plan: Plan; paymentMethodId: string;
  status: Status; trialEndsAt: string | null; createdAt: string; updatedAt: string;
}
export interface Invoice {
  id: string; subscriptionId: string; amount: number; currency: 'USD';
  status: 'pending' | 'paid' | 'failed' | 'refunded'; createdAt: string; updatedAt: string;
}
export interface WebhookEvent {
  eventId: string; type: string; invoiceId: string; subscriptionId: string;
  disposition: 'applied' | 'ignored' | 'duplicate'; receivedAt: string;
}
export interface AuditEntry { subscriptionId: string; from: Status | null; to: Status; reason: string; at: string }
export interface PaymentWebhook {
  event_id: string; type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  subscription_id: string; invoice_id: string; amount: number; currency: 'USD';
}
const transitions: Record<Status, Partial<Record<Trigger, Status>>> = {
  trialing: { charge_success: 'active', charge_failure: 'past_due', cancel: 'canceled' },
  active: { charge_failure: 'past_due', cancel: 'canceled' },
  past_due: { charge_success: 'active', retry_exhausted: 'canceled' },
  canceled: {}
};
export class SubscriptionLifecycleStateMachine {
  getNextStatus(from: Status, trigger: Trigger): Status | null { return transitions[from][trigger] ?? null; }
  static readonly transitions = transitions;
}
