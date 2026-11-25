
export type SubscriptionTestData = {
  id: string;
  customerId: string;
  planId: string;
  paymentMethodId: string;
};

export class SubscriptionBuilder {
  private data: SubscriptionTestData = {
    id: 'sub_test_001',
    customerId: 'cust_001',
    planId: 'plan_basic',
    paymentMethodId: 'pm_test_001'
  };

  withId(id: string): this {
    this.data.id = id;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.data.customerId = customerId;
    return this;
  }

  withPlanId(planId: string): this {
    this.data.planId = planId;
    return this;
  }

  withPaymentMethodId(paymentMethodId: string): this {
    this.data.paymentMethodId = paymentMethodId;
    return this;
  }

  build(): SubscriptionTestData {
    return { ...this.data };
  }
}
