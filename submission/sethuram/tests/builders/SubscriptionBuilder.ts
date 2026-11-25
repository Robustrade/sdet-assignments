export interface SubscriptionRequest {
  customerId: string;
  planId: string;
  paymentMethodId?: string;
}

export class SubscriptionBuilder {
  private customerId = "cust_001";
  private planId = "plan_basic";
  private paymentMethodId?: string;

  withCustomerId(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  withPlanId(planId: string): this {
    this.planId = planId;
    return this;
  }

  withPaymentMethodId(paymentMethodId: string): this {
    this.paymentMethodId = paymentMethodId;
    return this;
  }

  build(): SubscriptionRequest {
    return {
      customerId: this.customerId,
      planId: this.planId,
      ...(this.paymentMethodId !== undefined
        ? { paymentMethodId: this.paymentMethodId }
        : {})
    };
  }
}