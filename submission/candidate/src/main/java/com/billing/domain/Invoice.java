package com.billing.domain;

import java.time.Instant;

public class Invoice {

    public enum Status { PAID, FAILED, PENDING, REFUNDED }

    private final String id;
    private final String subscriptionId;
    private final int amountInCents;
    private final Status status;
    private final Instant createdAt;

    public Invoice(String id, String subscriptionId, int amountInCents, Status status) {
        this(id, subscriptionId, amountInCents, status, Instant.now());
    }

    private Invoice(String id, String subscriptionId, int amountInCents, Status status,
                    Instant createdAt) {
        this.id = id;
        this.subscriptionId = subscriptionId;
        this.amountInCents = amountInCents;
        this.status = status;
        this.createdAt = createdAt;
    }

    public String getId()             { return id; }
    public String getSubscriptionId() { return subscriptionId; }
    public int getAmountInCents()     { return amountInCents; }
    public Status getStatus()         { return status; }
    public Instant getCreatedAt()     { return createdAt; }

    public Invoice withStatus(Status newStatus) {
        return new Invoice(id, subscriptionId, amountInCents, newStatus, createdAt);
    }
}
