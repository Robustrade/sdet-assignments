/**
 * Builder for subscription creation payloads used in API tests.
 * Provides sensible defaults and chainable `with*` methods.
 */
export class SubscriptionPayloadBuilder {
  private payload = {
    customer_id: 'cust_001',
    plan: 'basic',
    payment_method_id: 'pm_test'
  };

  /** Set the customer id for the payload. */
  withCustomer(id: string) {
    this.payload.customer_id = id;
    return this;
  }

  /** Set the plan id for the payload. */
  withPlan(plan: string) {
    this.payload.plan = plan;
    return this;
  }

  /** Set the payment method id for the payload. */
  withPaymentMethod(id: string) {
    this.payload.payment_method_id = id;
    return this;
  }

  /** Build and return a shallow copy of the payload object. */
  build() {
    return { ...this.payload };
  }
}

/**
 * Builder for webhook payloads sent to the webhook endpoint in tests.
 */
export class WebhookBuilder {
  private payload = {
    event_id: `evt_${Date.now()}`,
    type: 'payment.succeeded',
    subscription_id: '',
    invoice_id: `inv_${Date.now()}`,
    amount: 1000,
    currency: 'USD'
  };

  /** Set an explicit event id for the webhook (useful for idempotency tests). */
  withEventId(id: string) {
    this.payload.event_id = id;
    return this;
  }

  /** Set the webhook event type (e.g. 'payment.succeeded'). */
  withType(type: string) {
    this.payload.type = type;
    return this;
  }

  /** Associate the webhook with a subscription id. */
  withSubscription(id: string) {
    this.payload.subscription_id = id;
    return this;
  }

  /** Explicitly set an invoice id for the webhook payload. */
  withInvoiceId(id: string) {
    this.payload.invoice_id = id;
    return this;
  }

  /** Build and return a shallow copy of the webhook payload. */
  build() {
    return { ...this.payload };
  }
}
