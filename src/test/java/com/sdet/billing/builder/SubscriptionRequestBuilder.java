package com.sdet.billing.builder;

import com.sdet.billing.enums.PlanType;
import lombok.Builder;
import lombok.Getter;

import java.util.HashMap;
import java.util.Map;

/**
 * Builder pattern — constructs subscription creation request payloads.
 *
 * Uses Lombok @Builder so a single field can be overridden for negative tests
 * without repeating the full object:
 *
 *   SubscriptionRequestBuilder.defaults()
 *       .toBuilder()
 *       .plan("unknown-plan")
 *       .build()
 *       .toMap()
 */
@Builder(toBuilder = true)
@Getter
public class SubscriptionRequestBuilder {

    private String customerId;
    private String plan;
    private String paymentMethodId;

    /** A fully populated, valid request for the PRO plan. */
    public static SubscriptionRequestBuilder defaults() {
        return SubscriptionRequestBuilder.builder()
            .customerId("cust_test_001")
            .plan(PlanType.PRO.getApiValue())
            .paymentMethodId("pm_test_visa_4242")
            .build();
    }

    /** A valid BASIC plan request with a different customer. */
    public static SubscriptionRequestBuilder basicPlan() {
        return SubscriptionRequestBuilder.builder()
            .customerId("cust_test_002")
            .plan(PlanType.BASIC.getApiValue())
            .paymentMethodId("pm_test_mastercard_5555")
            .build();
    }

    /**
     * Converts this builder state to a Map suitable for RestAssured .body(...).
     * Null fields are excluded so tests can intentionally omit required fields.
     */
    public Map<String, Object> toMap() {
        Map<String, Object> map = new HashMap<>();
        if (customerId != null)      map.put("customer_id",       customerId);
        if (plan != null)            map.put("plan",               plan);
        if (paymentMethodId != null) map.put("payment_method_id",  paymentMethodId);
        return map;
    }
}
