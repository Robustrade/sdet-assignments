export class SubscriptionRequestBuilder {
  private data: Record<string, unknown> = {
    customer_id: 'cust_001',
    plan: 'pro',
    payment_method_id: 'pm_test_visa_4242',
  };

  static aSubscription() { return new SubscriptionRequestBuilder(); }

  forCustomer(id: string) { this.data.customer_id = id; return this; }
  onPlan(plan: string) { this.data.plan = plan; return this; }
  withPaymentMethod(id: string) { this.data.payment_method_id = id; return this; }
  without(field: 'customer_id' | 'plan' | 'payment_method_id') { delete this.data[field]; return this; }
  build() { return { ...this.data }; }
}

export class WebhookEventBuilder {
  private data: Record<string, unknown> = {
    event_id: `evt_${Math.random().toString(16).slice(2, 10)}`,
    type: 'payment.succeeded',
    subscription_id: 'sub_unset',
    invoice_id: `inv_${Math.random().toString(16).slice(2, 10)}`,
    amount: 4900,
    currency: 'USD',
  };

  static aWebhook() { return new WebhookEventBuilder(); }

  succeeded() { this.data.type = 'payment.succeeded'; return this; }
  failed() { this.data.type = 'payment.failed'; return this; }
  refunded() { this.data.type = 'payment.refunded'; return this; }
  forSubscription(id: string) { this.data.subscription_id = id; return this; }
  forInvoice(id: string) { this.data.invoice_id = id; return this; }
  withEventId(id: string) { this.data.event_id = id; return this; }
  withAmount(amount: number) { this.data.amount = amount; return this; }
  without(field: string) { delete this.data[field]; return this; }
  withType(type: string) { this.data.type = type; return this; }
  build() { return { ...this.data }; }
}
