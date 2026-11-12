export type Status = 'trialing' | 'active' | 'past_due' | 'canceled';
export type PaymentStatus = 'succeeded' | 'failed' | 'refunded' | 'unknown';
export type Plan = 'basic' | 'pro';

export const PLANS: Record<Plan, { price: number; trialDays: number }> = {
  basic: { price: 1900, trialDays: 14 }, pro: { price: 4900, trialDays: 7 },
};

export class SubscriptionLifecycle {
  private static readonly transitions: Record<Status, Partial<Record<'success' | 'failure' | 'cancel' | 'exhausted', Status>>> = {
    trialing: { success: 'active', failure: 'past_due', cancel: 'canceled' },
    active: { failure: 'past_due', cancel: 'canceled' },
    past_due: { success: 'active', exhausted: 'canceled' }, canceled: {},
  };
  static transition(from: Status, trigger: 'success' | 'failure' | 'cancel' | 'exhausted'): Status {
    const next = this.transitions[from][trigger];
    if (!next) throw new Error(`Invalid transition: ${from} via ${trigger}`);
    return next;
  }
}

export interface Subscription { id: string; customer_id: string; plan: Plan; payment_method_id: string; status: Status; created_at: string; }
export interface Invoice { id: string; subscription_id: string; amount: number; currency: string; status: PaymentStatus; provider_reference: string; created_at: string; }
export interface WebhookEvent { event_id: string; subscription_id: string; type: string; disposition: 'processed' | 'duplicate' | 'ignored'; received_at: string; }
export interface AuditEvent { id: string; subscription_id: string; from: Status | null; to: Status; reason: string; created_at: string; }

export interface ChargeRequest { customerId: string; paymentMethodId: string; amount: number; currency: string; idempotencyKey: string; }
export type ChargeResult = { outcome: 'success' | 'decline' | 'timeout'; reference: string };
export interface PaymentProvider { charge(request: ChargeRequest): Promise<ChargeResult>; }

export class BillingRepository {
  readonly subscriptions = new Map<string, Subscription>();
  readonly invoices = new Map<string, Invoice>();
  readonly webhookEvents = new Map<string, WebhookEvent>();
  readonly auditEvents: AuditEvent[] = [];
  readonly customers = new Set(['cust_001', 'cust_002']);
  getSubscription(id: string) { return this.subscriptions.get(id); }
  invoicesFor(id: string) { return [...this.invoices.values()].filter(x => x.subscription_id === id); }
  eventsFor(id: string) { return this.auditEvents.filter(x => x.subscription_id === id); }
}
