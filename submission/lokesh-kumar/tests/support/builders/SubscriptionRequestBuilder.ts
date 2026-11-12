export type CreateRequestField = 'customer_id' | 'plan' | 'payment_method_id';

/** Builds the body of POST /subscriptions. Defaults are valid, so tests state only what matters. */
export class CreateSubscriptionRequestBuilder {
  private fields: Record<string, unknown> = {
    customer_id: 'cust_001',
    plan: 'pro',
    payment_method_id: 'pm_test_visa_4242',
  };

  forCustomer(id: string): this {
    this.fields.customer_id = id;
    return this;
  }
  onPlan(plan: string): this {
    this.fields.plan = plan;
    return this;
  }
  withPaymentMethod(id: string): this {
    this.fields.payment_method_id = id;
    return this;
  }
  without(field: CreateRequestField): this {
    delete this.fields[field];
    return this;
  }
  build(): Record<string, unknown> {
    return { ...this.fields };
  }
}

export const aCreateSubscriptionRequest = (): CreateSubscriptionRequestBuilder =>
  new CreateSubscriptionRequestBuilder();
