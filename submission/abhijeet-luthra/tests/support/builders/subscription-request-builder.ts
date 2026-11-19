/** Builds create-subscription request bodies with valid defaults and readable overrides. */
export class SubscriptionRequestBuilder {
  private body: Record<string, unknown> = {
    customer_id: 'cust_001',
    plan: 'pro',
    payment_method_id: 'pm_test_visa_4242',
  };

  forCustomer(customerId: string): this {
    this.body.customer_id = customerId;
    return this;
  }

  onPlan(plan: string): this {
    this.body.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.body.payment_method_id = paymentMethodId;
    return this;
  }

  without(field: 'customer_id' | 'plan' | 'payment_method_id'): this {
    delete this.body[field];
    return this;
  }

  with(field: string, value: unknown): this {
    this.body[field] = value;
    return this;
  }

  build(): Record<string, unknown> {
    return { ...this.body };
  }
}

export const aSubscriptionRequest = (): SubscriptionRequestBuilder => new SubscriptionRequestBuilder();
