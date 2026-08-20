import { CreateSubscriptionInput } from '../../service/SubscriptionService';

/** Builder pattern: lets tests read as intent ("a pro-plan subscription for a new customer") instead of repeated object literals. */
export class SubscriptionBuilder {
  private input: CreateSubscriptionInput = {
    customerId: 'cust_001',
    plan: 'pro',
    paymentMethodId: 'pm_test_visa_4242',
  };

  withCustomer(customerId: string): this {
    this.input.customerId = customerId;
    return this;
  }

  withPlan(plan: string): this {
    this.input.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.input.paymentMethodId = paymentMethodId;
    return this;
  }

  withoutPaymentMethod(): this {
    // @ts-expect-error - intentionally building an invalid payload for validation tests
    delete this.input.paymentMethodId;
    return this;
  }

  build(): CreateSubscriptionInput {
    return { ...this.input };
  }
}
