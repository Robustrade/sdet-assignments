import { DEFAULT_CUSTOMER_ID } from '../fixtureSeeder';

export class SubscriptionRequestBuilder {
  private customerId: string = DEFAULT_CUSTOMER_ID;

  private plan = 'pro';

  private paymentMethodId = 'pm_test_visa_4242';

  forCustomer(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  withPlan(plan: string): this {
    this.plan = plan;
    return this;
  }

  withPaymentMethod(pm: string): this {
    this.paymentMethodId = pm;
    return this;
  }

  withoutCustomerId(): this {
    this.customerId = undefined as unknown as string;
    return this;
  }

  withoutPaymentMethod(): this {
    this.paymentMethodId = undefined as unknown as string;
    return this;
  }

  build() {
    return { customer_id: this.customerId, plan: this.plan, payment_method_id: this.paymentMethodId };
  }
}
