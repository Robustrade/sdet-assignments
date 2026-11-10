package com.billing.builders;

import java.util.HashMap;
import java.util.Map;

public class SubscriptionRequestBuilder {

    private String customerId      = "cust_001";
    private String plan            = "pro";
    private String paymentMethodId = "pm_test_visa_4242";

    public static SubscriptionRequestBuilder aSubscription() {
        return new SubscriptionRequestBuilder();
    }

    public SubscriptionRequestBuilder withCustomerId(String customerId) {
        this.customerId = customerId;
        return this;
    }

    public SubscriptionRequestBuilder withPlan(String plan) {
        this.plan = plan;
        return this;
    }

    public SubscriptionRequestBuilder withPaymentMethodId(String paymentMethodId) {
        this.paymentMethodId = paymentMethodId;
        return this;
    }

    public SubscriptionRequestBuilder withoutCustomerId() {
        this.customerId = null;
        return this;
    }

    public SubscriptionRequestBuilder withoutPaymentMethod() {
        this.paymentMethodId = null;
        return this;
    }

    public Map<String, String> build() {
        Map<String, String> body = new HashMap<>();
        if (customerId != null)      body.put("customer_id", customerId);
        if (plan != null)            body.put("plan", plan);
        if (paymentMethodId != null) body.put("payment_method_id", paymentMethodId);
        return body;
    }
}
