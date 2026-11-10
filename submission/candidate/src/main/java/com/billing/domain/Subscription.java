package com.billing.domain;

import java.time.Instant;

public class Subscription {

    private final String id;
    private final String customerId;
    private final Plan plan;
    private final String paymentMethodId;
    private SubscriptionStatus status;
    private final Instant createdAt;
    private Instant updatedAt;

    public Subscription(String id, String customerId, Plan plan,
                        String paymentMethodId, SubscriptionStatus status) {
        this.id = id;
        this.customerId = customerId;
        this.plan = plan;
        this.paymentMethodId = paymentMethodId;
        this.status = status;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public synchronized void applyStatus(SubscriptionStatus newStatus, SubscriptionStateMachine sm) {
        this.status = sm.transition(this.status, newStatus);
        this.updatedAt = Instant.now();
    }

    public synchronized Snapshot snapshot() {
        return new Snapshot(id, customerId, plan, paymentMethodId,
            status, createdAt, updatedAt);
    }

    public record Snapshot(String id, String customerId, Plan plan,
                           String paymentMethodId, SubscriptionStatus status,
                           Instant createdAt, Instant updatedAt) {}

    public synchronized String getId()                 { return id; }
    public synchronized String getCustomerId()         { return customerId; }
    public synchronized Plan getPlan()                 { return plan; }
    public synchronized String getPaymentMethodId()    { return paymentMethodId; }
    public synchronized SubscriptionStatus getStatus() { return status; }
    public synchronized Instant getCreatedAt()         { return createdAt; }
    public synchronized Instant getUpdatedAt()         { return updatedAt; }
}
