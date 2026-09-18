import { CreateSubscriptionBody } from "../ApiClient";

/**
 * Builder pattern. Every field has a sane default so a scenario only overrides what it's
 * actually testing -- e.g. `.withPlan("unknown-plan").build()` for a validation test reads as
 * "everything normal except the plan", instead of a five-field object literal repeated with one
 * field changed in every test.
 */
export class SubscriptionRequestBuilder {
  private customerId: unknown = "cust_001";
  private plan: unknown = "pro";
  private paymentMethodId: unknown = "pm_test_visa_4242";

  withCustomer(customerId: unknown): this {
    this.customerId = customerId;
    return this;
  }

  withPlan(plan: unknown): this {
    this.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: unknown): this {
    this.paymentMethodId = paymentMethodId;
    return this;
  }

  withoutCustomer(): this {
    this.customerId = undefined;
    return this;
  }

  withoutPaymentMethod(): this {
    this.paymentMethodId = undefined;
    return this;
  }

  build(): CreateSubscriptionBody {
    return {
      customer_id: this.customerId,
      plan: this.plan,
      payment_method_id: this.paymentMethodId,
    };
  }
}
