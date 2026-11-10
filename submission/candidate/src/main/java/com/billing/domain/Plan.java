package com.billing.domain;

public enum Plan {
    BASIC(1900, 14),
    PRO(4900, 7),
    IMMEDIATE(9900, 0);

    private final int priceInCents;
    private final int trialDays;

    Plan(int priceInCents, int trialDays) {
        this.priceInCents = priceInCents;
        this.trialDays = trialDays;
    }

    public int getPriceInCents() { return priceInCents; }
    public int getTrialDays()    { return trialDays; }

    public SubscriptionStatus initialStatus() {
        return SubscriptionStatus.TRIALING;
    }
}
