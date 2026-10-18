package com.sdet.billing.constants;

/**
 * All API endpoint paths in one place.
 * Tests reference these constants rather than hard-coding strings.
 */
public final class ApiEndpoints {

    private ApiEndpoints() {}

    public static final String SUBSCRIPTIONS         = "/subscriptions";
    public static final String SUBSCRIPTION_BY_ID   = "/subscriptions/{id}";
    public static final String CANCEL_SUBSCRIPTION  = "/subscriptions/{id}/cancel";
    public static final String WEBHOOK_PAYMENT      = "/webhooks/payment-provider";
}
