package com.sdet.billing.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum PlanType {
    BASIC(990,  7,  "basic"),
    PRO  (4900, 14, "pro");

    private final int priceInCents;
    private final int trialDays;
    private final String apiValue;

    public static PlanType fromApiValue(String value) {
        for (PlanType p : values()) {
            if (p.apiValue.equalsIgnoreCase(value)) return p;
        }
        throw new IllegalArgumentException("Unknown plan: " + value);
    }
}
