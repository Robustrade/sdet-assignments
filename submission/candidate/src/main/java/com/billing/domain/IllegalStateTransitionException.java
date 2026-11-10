package com.billing.domain;

public class IllegalStateTransitionException extends RuntimeException {
    public IllegalStateTransitionException(SubscriptionStatus from, SubscriptionStatus to) {
        super("Illegal transition: " + from + " -> " + to);
    }
}
