/**
 * Builder for POST /subscriptions request bodies. Defaults to a valid request;
 * each invalid scenario is expressed as one deliberate deviation.
 */
export class SubscriptionRequestBuilder {
  private fields: Record<string, unknown> = {
    customer_id: 'cust_001',
    plan: 'pro',
    payment_method_id: 'pm_test_visa_4242',
  };

  forCustomer(customerId: unknown): this {
    return this.with('customer_id', customerId);
  }

  onPlan(plan: unknown): this {
    return this.with('plan', plan);
  }

  withPaymentMethod(paymentMethodId: unknown): this {
    return this.with('payment_method_id', paymentMethodId);
  }

  with(field: string, value: unknown): this {
    this.fields[field] = value;
    return this;
  }

  without(field: string): this {
    delete this.fields[field];
    return this;
  }

  build(): Record<string, unknown> {
    return { ...this.fields };
  }
}

export const aSubscriptionRequest = (): SubscriptionRequestBuilder => new SubscriptionRequestBuilder();
