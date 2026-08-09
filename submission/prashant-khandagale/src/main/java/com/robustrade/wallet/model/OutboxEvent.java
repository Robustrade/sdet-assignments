package com.robustrade.wallet.model;

import java.time.Instant;

/**
 * Outbox pattern row: written in the SAME DB transaction as the transfer, so
 * "transfer completed" and "an event exists to notify downstream systems"
 * either both happen or neither does -- no partial state.
 *
 * A real system would have a separate publisher process draining this table
 * to Kafka/SNS/etc. and marking rows PUBLISHED. This fixture stubs that
 * publisher: it just marks the row PUBLISHED synchronously so tests can
 * assert "exactly one outbox row per completed transfer" without needing a
 * real message broker.
 */
public class OutboxEvent {

    private final long id;
    private final String transferId;
    private final String eventType; // e.g. TRANSFER_COMPLETED
    private final String payload;
    private final String status; // PENDING | PUBLISHED
    private final Instant createdAt;

    public OutboxEvent(long id, String transferId, String eventType, String payload,
                        String status, Instant createdAt) {
        this.id = id;
        this.transferId = transferId;
        this.eventType = eventType;
        this.payload = payload;
        this.status = status;
        this.createdAt = createdAt;
    }

    public long getId() { return id; }
    public String getTransferId() { return transferId; }
    public String getEventType() { return eventType; }
    public String getPayload() { return payload; }
    public String getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
}
