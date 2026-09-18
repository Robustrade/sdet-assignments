/**
 * BUILDER for subscription creation requests.
 *
 * Scenarios name only what they care about ("a request with no plan"); the
 * builder supplies a valid remainder, so a future required field is added in
 * one place instead of in every test.
 */
export class SubscriptionRequestBuilder {
  private payload: Record<string, unknown> = {
    customer_id: 'cust_001',
    plan: 'pro',
    payment_method_id: 'pm_test_visa_4242'
  };

  static aRequest(): SubscriptionRequestBuilder {
    return new SubscriptionRequestBuilder();
  }

  forCustomer(customerId: string): this {
    this.payload.customer_id = customerId;
    return this;
  }

  onPlan(plan: string): this {
    this.payload.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.payload.payment_method_id = paymentMethodId;
    return this;
  }

  without(field: 'customer_id' | 'plan' | 'payment_method_id'): this {
    delete this.payload[field];
    return this;
  }

  with(field: string, value: unknown): this {
    this.payload[field] = value;
    return this;
  }

  build(): Record<string, unknown> {
    return structuredClone(this.payload);
  }
}
