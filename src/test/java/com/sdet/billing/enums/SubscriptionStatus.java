package com.sdet.billing.enums;

public enum SubscriptionStatus {
    TRIALING,
    ACTIVE,
    PAST_DUE,
    CANCELED;

    /** Returns the lowercase string as returned by the API (e.g. "trialing"). */
    public String apiValue() {
        return name().toLowerCase();
    }

    public boolean isTerminal() {
        return this == CANCELED;
    }

    public static SubscriptionStatus fromApiValue(String value) {
        for (SubscriptionStatus s : values()) {
            if (s.apiValue().equalsIgnoreCase(value)) return s;
        }
        throw new IllegalArgumentException("Unknown subscription status: " + value);
    }
}
