import { PlanId } from "../domain/Plan";
import { Subscription } from "../domain/Subscription";
import { SubscriptionStatus } from "../domain/SubscriptionStatus";

export class SubscriptionBuilder {
  private subscription: Subscription = {
    id: `subscription_${Date.now()}`,
    customerId: "customer_1",
    planId: "basic",
    status: SubscriptionStatus.TRIALING,
    trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    currentPeriodEndsAt: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ),
    createdAt: new Date(),
    retryCount: 0,
    maxRetries: 3,
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

  withStatus(status: SubscriptionStatus): this {
    this.subscription.status = status;
    return this;
  }

  withTrialEndsAt(trialEndsAt: Date): this {
    this.subscription.trialEndsAt = trialEndsAt;
    return this;
  }

  withRetryCount(retryCount: number): this {
    this.subscription.retryCount = retryCount;
    return this;
  }

  withMaxRetries(maxRetries: number): this {
    this.subscription.maxRetries = maxRetries;
    return this;
  }

  build(): Subscription {
    return {
      ...this.subscription,
    };
  }
}