import type { Customer } from '../../../src/domain/types';

type Body = Record<string, unknown>;

/** PATTERN: Builder. Reads as intent: aSubscriptionRequest().forCustomer(c).onPlan('pro').build() */
export class SubscriptionRequestBuilder {
  private body: Body = {
    customer_id: 'cust_001',
    plan: 'basic',
    payment_method_id: 'pm_test_visa_4242',
  };
  forCustomer(c: Customer): this {
    this.body.customer_id = c.id;
    this.body.payment_method_id = c.paymentMethodIds[0];
    return this;
  }
  onPlan(plan: string): this {
    this.body.plan = plan;
    return this;
  }
  withPaymentMethod(id: string): this {
    this.body.payment_method_id = id;
    return this;
  }
  withCustomerId(id: string): this {
    this.body.customer_id = id;
    return this;
  }
  with(field: string, value: unknown): this {
    this.body[field] = value;
    return this;
  }
  without(field: string): this {
    delete this.body[field];
    return this;
  }
  build(): Body {
    return { ...this.body };
  }
}
export const aSubscriptionRequest = () => new SubscriptionRequestBuilder();
