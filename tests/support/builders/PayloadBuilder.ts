export class SubscriptionPayloadBuilder {
  private payload = {
    customer_id: 'cust_001',
    plan: 'basic',
    payment_method_id: 'pm_test'
  };

  withCustomer(id: string) {
    this.payload.customer_id = id;
    return this;
  }

  withPlan(plan: string) {
    this.payload.plan = plan;
    return this;
  }

  withPaymentMethod(id: string) {
    this.payload.payment_method_id = id;
    return this;
  }

  build() {
    return { ...this.payload };
  }
}

export class WebhookBuilder {
  private payload = {
    event_id: `evt_${Date.now()}`,
    type: 'payment.succeeded',
    subscription_id: '',
    invoice_id: `inv_${Date.now()}`,
    amount: 1000,
    currency: 'USD'
  };

  withEventId(id: string) {
    this.payload.event_id = id;
    return this;
  }

  withType(type: string) {
    this.payload.type = type;
    return this;
  }

  withSubscription(id: string) {
    this.payload.subscription_id = id;
    return this;
  }

  withInvoiceId(id: string) {
    this.payload.invoice_id = id;
    return this;
  }

  build() {
    return { ...this.payload };
  }
}
