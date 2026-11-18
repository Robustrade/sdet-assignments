
import {
  Subscription,
  SubscriptionStatus,
  PlanType
} from '../src/models/subscription';

export class SubscriptionBuilder {
  private subscription: Subscription = {
    id: 'sub-test-001',
    customer_id: 'customer-test-001',
    plan: 'basic',
    status: 'trialing',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    canceled_at: null
  };

  withId(id: string): this {
    this.subscription.id = id;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.subscription.customer_id = customerId;
    return this;
  }

  withPlan(plan: PlanType): this {
    this.subscription.plan = plan;
    return this;
  }

  withStatus(status: SubscriptionStatus): this {
    this.subscription.status = status;
    return this;
  }

  build(): Subscription {
    return { ...this.subscription };
  }
}
