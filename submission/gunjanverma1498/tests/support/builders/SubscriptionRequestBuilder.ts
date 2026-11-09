/**
 * Builder for subscription-creation request bodies.
 *
 * Lets scenarios read as intent ("a pro subscription for cust_001") instead of
 * repeated object literals, and makes invalid variants explicit via named
 * mutators (`withoutPlan`, `withUnknownCustomer`, ...).
 */
export interface SubscriptionRequestBody {
  customer_id?: string;
  plan?: string;
  payment_method_id?: string;
}

export class SubscriptionRequestBuilder {
  private body: SubscriptionRequestBody = {
    customer_id: 'cust_001',
    plan: 'pro',
    payment_method_id: 'pm_test_visa_4242',
  };

  static aSubscription(): SubscriptionRequestBuilder {
    return new SubscriptionRequestBuilder();
  }

  forCustomer(customerId: string): this {
    this.body.customer_id = customerId;
    return this;
  }

  withPlan(plan: string): this {
    this.body.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.body.payment_method_id = paymentMethodId;
    return this;
  }

  withoutPlan(): this {
    delete this.body.plan;
    return this;
  }

  withoutCustomer(): this {
    delete this.body.customer_id;
    return this;
  }

  withoutPaymentMethod(): this {
    delete this.body.payment_method_id;
    return this;
  }

  build(): SubscriptionRequestBody {
    return { ...this.body };
  }
}
