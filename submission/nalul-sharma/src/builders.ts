import { randomUUID } from 'node:crypto';
import type { PaymentWebhook, Plan } from './domain.ts';
export class SubscriptionTestDataBuilder {
  private data = { customer_id: 'cust_001', plan: 'pro', payment_method_id: 'pm_test_visa_4242' };
  withPlan(plan: Plan) { this.data.plan = plan; return this; }
  withCustomerId(id: string) { this.data.customer_id = id; return this; }
  withPaymentMethodId(id: string) { this.data.payment_method_id = id; return this; }
  buildSubscriptionInput() { return { ...this.data }; }
}
export class PaymentWebhookTestDataBuilder {
  private data: PaymentWebhook;
  constructor(subscriptionId: string, invoiceId: string, amount = 4900) {
    this.data = { event_id: `evt_${randomUUID()}`, type: 'payment.succeeded',
      subscription_id: subscriptionId, invoice_id: invoiceId, amount, currency: 'USD' };
  }
  withEventType(eventType: PaymentWebhook['type']) { this.data.type = eventType; return this; }
  withEventId(eventId: string) { this.data.event_id = eventId; return this; }
  buildPaymentWebhook(): PaymentWebhook { return { ...this.data }; }
}
