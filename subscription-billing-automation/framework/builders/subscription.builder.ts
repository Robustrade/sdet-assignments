import { Subscription } from '../../src/domain/models/subscription.model';
import { SubscriptionState } from '../../src/domain/state/subscription-state.interface';
import { TrialingState } from '../../src/domain/state/trialing.state';

export interface CreateSubscriptionPayload {
  customer_id: string;
  plan: string;
  payment_method_id: string;
}

export class SubscriptionBuilder {
  private id = 'sub_test_1';
  private customerId = 'cust_001';
  private plan = 'basic';
  private paymentMethodId = 'pm_test_visa_4242';
  private state: SubscriptionState = new TrialingState();

  withId(id: string): this {
    this.id = id;
    return this;
  }

  forCustomer(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  onPlan(plan: string): this {
    this.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.paymentMethodId = paymentMethodId;
    return this;
  }

  inState(state: SubscriptionState): this {
    this.state = state;
    return this;
  }

  build(): Subscription {
    return new Subscription(this.id, this.customerId, this.plan, this.paymentMethodId, this.state);
  }

  buildCreatePayload(): CreateSubscriptionPayload {
    return {
      customer_id: this.customerId,
      plan: this.plan,
      payment_method_id: this.paymentMethodId,
    };
  }
}
