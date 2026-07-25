class SubscriptionRequestBuilder {
  constructor() {
    this.payload = {
      customer_id: 'cust_001',
      plan: 'pro',
      payment_method_id: 'pm_test_visa_4242',
    };
  }

  withCustomer(customerId) {
    this.payload.customer_id = customerId;
    return this;
  }

  withPlan(plan) {
    this.payload.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId) {
    this.payload.payment_method_id = paymentMethodId;
    return this;
  }

  build() {
    return { ...this.payload };
  }
}

module.exports = {
  SubscriptionRequestBuilder,
};
