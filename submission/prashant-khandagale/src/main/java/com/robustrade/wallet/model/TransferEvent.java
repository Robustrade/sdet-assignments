package com.robustrade.wallet.model;

import java.time.Instant;

/**
 * Append-only audit trail row: "this transfer reached this state at this time".
 * Never updated or deleted -- only ever inserted.
 */
public class TransferEvent {

    private final long id;
    private final String transferId;
    private final String eventType; // e.g. TRANSFER_CREATED, TRANSFER_COMPLETED, TRANSFER_REJECTED
    private final String details;
    private final Instant createdAt;

    public TransferEvent(long id, String transferId, String eventType, String details, Instant createdAt) {
        this.id = id;
        this.transferId = transferId;
        this.eventType = eventType;
        this.details = details;
        this.createdAt = createdAt;
    }

    public long getId() { return id; }
    public String getTransferId() { return transferId; }
    public String getEventType() { return eventType; }
    public String getDetails() { return details; }
    public Instant getCreatedAt() { return createdAt; }
}
