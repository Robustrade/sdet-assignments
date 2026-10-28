import { randomUUID } from 'node:crypto';
import type { PaymentWebhook, Plan } from './domain.ts';
export class SubscriptionBuilder {
  private data = { customer_id: 'cust_001', plan: 'pro', payment_method_id: 'pm_test_visa_4242' };
  withPlan(plan: Plan) { this.data.plan = plan; return this; }
  withCustomer(id: string) { this.data.customer_id = id; return this; }
  withPaymentMethod(id: string) { this.data.payment_method_id = id; return this; }
  build() { return { ...this.data }; }
}
export class WebhookBuilder {
  private data: PaymentWebhook;
  constructor(subscriptionId: string, invoiceId: string, amount = 4900) {
    this.data = { event_id: `evt_${randomUUID()}`, type: 'payment.succeeded',
      subscription_id: subscriptionId, invoice_id: invoiceId, amount, currency: 'USD' };
  }
  type(type: PaymentWebhook['type']) { this.data.type = type; return this; }
  eventId(id: string) { this.data.event_id = id; return this; }
  build(): PaymentWebhook { return { ...this.data }; }
}
