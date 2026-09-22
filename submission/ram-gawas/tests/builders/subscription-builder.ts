import type { CreateSubscriptionRequest } from '../../src/subscription-service';

export class SubscriptionBuilder {
  private request: CreateSubscriptionRequest = {
    id: 'sub_001',
    customerId: 'cust_001',
    plan: 'pro',
    paymentMethodId: 'pm_001',
  };

  withId(id: string): this {
    this.request.id = id;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.request.customerId = customerId;
    return this;
  }

  withPlan(plan: string): this {
    this.request.plan = plan;
    return this;
  }

  withPaymentMethodId(paymentMethodId: string): this {
    this.request.paymentMethodId = paymentMethodId;
    return this;
  }

  build(): CreateSubscriptionRequest {
    return { ...this.request };
  }
}
