import type { Plan } from './domain.js';

export class SubscriptionRequestBuilder {
  private value: Record<string, unknown> = { customer_id: 'cust_001', plan: 'pro', payment_method_id: 'pm_test_visa_4242' };
  customer(id: string) { this.value.customer_id = id; return this; }
  plan(plan: Plan | string) { this.value.plan = plan; return this; }
  paymentMethod(id: string) { this.value.payment_method_id = id; return this; }
  omit(key: string) { delete this.value[key]; return this; }
  build() { return { ...this.value }; }
}

export class WebhookBuilder {
  private value: Record<string, unknown> = { event_id: 'evt_default', type: 'payment.succeeded', subscription_id: 'sub_1', invoice_id: 'inv_default', amount: 4900, currency: 'USD' };
  eventId(value: string) { this.value.event_id = value; return this; }
  type(value: string) { this.value.type = value; return this; }
  subscription(id: string) { this.value.subscription_id = id; return this; }
  invoice(id: string) { this.value.invoice_id = id; return this; }
  amount(value: number) { this.value.amount = value; return this; }
  build() { return { ...this.value }; }
}
