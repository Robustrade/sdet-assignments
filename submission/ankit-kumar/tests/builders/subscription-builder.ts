import type { Subscription } from "../../src/infrastructure/subscription-repository";

export class SubscriptionBuilder {
  private data: Subscription = {
    id: "sub_test_001",
    customerId: "cust_test_001",
    plan: "basic",
    paymentMethodId: "pm_test_visa_4242",
    status: "trialing",
    createdAt: "2026-11-13T10:00:00.000Z",
    updatedAt: "2026-11-13T10:00:00.000Z"
  };

  withId(id: string): this {
    this.data.id = id;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.data.customerId = customerId;
    return this;
  }

  withPlan(plan: string): this {
    this.data.plan = plan;
    return this;
  }

  withPaymentMethodId(paymentMethodId: string): this {
    this.data.paymentMethodId = paymentMethodId;
    return this;
  }

  withStatus(status: Subscription["status"]): this {
    this.data.status = status;
    return this;
  }

  build(): Subscription {
    return { ...this.data };
  }
}