import { CUSTOMER_1, type CustomerRef } from '../testData';

/** Builds the body for POST /subscriptions. Defaults to a valid pro request for cust_001. */
export class SubscriptionRequestBuilder {
  private readonly body: Record<string, unknown> = {
    customer_id: CUSTOMER_1.id,
    plan: 'pro',
    payment_method_id: CUSTOMER_1.paymentMethodId,
  };

  forCustomer(customer: CustomerRef): this {
    this.body.customer_id = customer.id;
    this.body.payment_method_id = customer.paymentMethodId;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.body.customer_id = customerId;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.body.payment_method_id = paymentMethodId;
    return this;
  }

  onPlan(plan: string): this {
    this.body.plan = plan;
    return this;
  }

  /** Sets any field to any value, including wrong types. */
  with(field: string, value: unknown): this {
    this.body[field] = value;
    return this;
  }

  without(field: string): this {
    delete this.body[field];
    return this;
  }

  build(): Record<string, unknown> {
    return { ...this.body };
  }
}

export const aSubscriptionRequest = (): SubscriptionRequestBuilder => new SubscriptionRequestBuilder();
