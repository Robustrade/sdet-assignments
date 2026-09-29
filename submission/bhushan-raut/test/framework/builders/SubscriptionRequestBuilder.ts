import type { CustomerSeed } from './CustomerBuilder';

export type PlanCode = 'basic' | 'pro';

export class SubscriptionRequestBuilder {
  private readonly body: Record<string, unknown> = {};

  forCustomer(customer: CustomerSeed): this {
    this.body.customer_id = customer.id;
    this.body.payment_method_id = customer.paymentMethodId;
    return this;
  }

  /** Accepts any string so tests can request unknown plans. */
  onPlan(plan: PlanCode | (string & {})): this {
    this.body.plan = plan;
    return this;
  }

  with(field: string, value: unknown): this {
    this.body[field] = value;
    return this;
  }

  without(field: string): this {
    delete this.body[field];
    return this;
  }

  build(): Record<string, unknown> {
    return structuredClone(this.body);
  }
}

export const aSubscriptionRequest = () => new SubscriptionRequestBuilder().onPlan('basic');
