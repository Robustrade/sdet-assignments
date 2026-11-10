package com.billing.domain;

import java.util.Map;
import java.util.Set;

public class SubscriptionStateMachine {

    private static final Map<SubscriptionStatus, Set<SubscriptionStatus>> ALLOWED_TRANSITIONS =
        Map.of(
            SubscriptionStatus.TRIALING, Set.of(
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.PAST_DUE,
                SubscriptionStatus.CANCELED
            ),
            SubscriptionStatus.ACTIVE, Set.of(
                SubscriptionStatus.PAST_DUE,
                SubscriptionStatus.CANCELED
            ),
            SubscriptionStatus.PAST_DUE, Set.of(
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.CANCELED
            ),
            SubscriptionStatus.CANCELED, Set.of()
        );

    public boolean canTransition(SubscriptionStatus from, SubscriptionStatus to) {
        return ALLOWED_TRANSITIONS.getOrDefault(from, Set.of()).contains(to);
    }

    public SubscriptionStatus transition(SubscriptionStatus from, SubscriptionStatus to) {
        if (!canTransition(from, to)) {
            throw new IllegalStateTransitionException(from, to);
        }
        return to;
    }
}
