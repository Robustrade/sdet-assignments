import { PlanName } from '../domain/plan';
import { SubscriptionStatus } from '../domain/subscription-state';

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanName;
  paymentMethodId: string;
  status: SubscriptionStatus;
}

export class SubscriptionBuilder {
  private subscription: Subscription = {
    id: `sub_${Date.now()}`,
    customerId: 'cust_001',
    plan: 'pro',
    paymentMethodId: 'pm_test_visa_4242',
    status: 'trialing',
  };

  withId(id: string): this {
    this.subscription.id = id;
    return this;
  }

  forCustomer(customerId: string): this {
    this.subscription.customerId = customerId;
    return this;
  }

  withPlan(plan: PlanName): this {
    this.subscription.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.subscription.paymentMethodId = paymentMethodId;
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
