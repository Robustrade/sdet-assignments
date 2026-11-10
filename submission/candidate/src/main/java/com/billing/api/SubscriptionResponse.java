package com.billing.api;

import com.billing.domain.Subscription;

public record SubscriptionResponse(
    String id,
    String customerId,
    String plan,
    String status,
    String paymentMethodId,
    String createdAt,
    String updatedAt
) {
    public static SubscriptionResponse from(Subscription sub) {
        Subscription.Snapshot snapshot = sub.snapshot();
        return new SubscriptionResponse(
            snapshot.id(),
            snapshot.customerId(),
            snapshot.plan().name().toLowerCase(),
            snapshot.status().name().toLowerCase(),
            snapshot.paymentMethodId(),
            snapshot.createdAt().toString(),
            snapshot.updatedAt().toString()
        );
    }
}
