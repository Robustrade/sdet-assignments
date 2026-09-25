import type { Subscription } from "../domain/subscription.js";
import type { PlanId } from "../domain/plan.js";
import type { SubscriptionState } from "../domain/subscription-state.js";

export class SubscriptionBuilder {
  private subscription: Subscription = {
    id: "sub_001",
    customerId: "cust_001",
    planId: "pro",
    paymentMethodId: "pm_test_visa_4242",
    state: "trialing",
    createdAt: new Date(),
  };

  withId(id: string): this {
    this.subscription.id = id;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.subscription.customerId = customerId;
    return this;
  }

  withPlanId(planId: PlanId): this {
    this.subscription.planId = planId;
    return this;
  }

  withPaymentMethodId(paymentMethodId: string): this {
    this.subscription.paymentMethodId = paymentMethodId;
    return this;
  }

  withState(state: SubscriptionState): this {
    this.subscription.state = state;
    return this;
  }

  build(): Subscription {
    return {
      ...this.subscription,
    };
  }
}