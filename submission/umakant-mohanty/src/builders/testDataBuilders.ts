import { CreateSubscriptionRequest, PaymentEventType, PlanCode } from '../domain/models';
import { createHmac } from 'node:crypto';

export class SubscriptionRequestBuilder {
  private value: CreateSubscriptionRequest = { customerId: 'cust_001', plan: 'pro', paymentMethodId: 'pm_test_visa_4242' };
  withCustomer(customerId: string): this { this.value.customerId = customerId; return this; }
  withPlan(plan: PlanCode): this { this.value.plan = plan; return this; }
  withPaymentMethod(paymentMethodId: string): this { this.value.paymentMethodId = paymentMethodId; return this; }
  build(): CreateSubscriptionRequest { return structuredClone(this.value); }
}

export class WebhookBuilder {
  private value = {
    event_id: 'evt_001', type: 'payment.succeeded' as PaymentEventType, subscription_id: 'sub_001', invoice_id: 'inv_001', amount: 4900, currency: 'USD'
  };
  withEventId(v: string): this { this.value.event_id = v; return this; }
  withType(v: PaymentEventType): this { this.value.type = v; return this; }
  withSubscription(v: string): this { this.value.subscription_id = v; return this; }
  withInvoice(v: string): this { this.value.invoice_id = v; return this; }
  withAmount(v: number): this { this.value.amount = v; return this; }
  build(): typeof this.value { return structuredClone(this.value); }
  sign(secret: string, payload = this.build()): string {
    return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  }
}
