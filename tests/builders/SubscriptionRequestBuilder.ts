import type { PlanId } from '../../src/domain/types.js';
import { CustomerBuilder } from './CustomerBuilder.js';

export interface SubscriptionApiRequest {
  customer_id: string;
  plan: PlanId;
  payment_method_id: string;
}

export class SubscriptionRequestBuilder {
  private customer: CustomerBuilder;
  private plan: PlanId = 'basic';
  private paymentMethodId: string | undefined;

  constructor() {
    this.customer = new CustomerBuilder();
  }

  onPlan(plan: PlanId): this {
    this.plan = plan;
    return this;
  }

  forCustomer(id: string): this {
    this.customer.withId(id);
    return this;
  }

  withPaymentMethod(id: string): this {
    this.paymentMethodId = id;
    return this;
  }

  withCustomer(customer: CustomerBuilder): this {
    this.customer = customer;
    return this;
  }

  build(): SubscriptionApiRequest {
    const customer = this.customer.build();
    return {
      customer_id: customer.customerId,
      plan: this.plan,
      payment_method_id: this.paymentMethodId ?? customer.paymentMethodId,
    };
  }
}