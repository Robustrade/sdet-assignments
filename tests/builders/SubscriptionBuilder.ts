import { Subscription } from "../../src/domain/Subscription";
import { SubscriptionStatus } from "../../src/domain/SubscriptionStatus";

export class SubscriptionBuilder {
  private subscription: Subscription = {
    id: "sub_001",
    customerId: "cust_001",
    plan: "pro",
    status: SubscriptionStatus.TRIALING
  };

  withId(id: string): SubscriptionBuilder {
    this.subscription.id = id;
    return this;
  }

  withCustomer(
    customerId: string
  ): SubscriptionBuilder {
    this.subscription.customerId = customerId;
    return this;
  }

  withPlan(
    plan: string
  ): SubscriptionBuilder {
    this.subscription.plan = plan;
    return this;
  }

  withStatus(
    status: SubscriptionStatus
  ): SubscriptionBuilder {
    this.subscription.status = status;
    return this;
  }

  build(): Subscription {
    return {
      ...this.subscription
    };
  }
}