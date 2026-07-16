package com.wallet.transfer.model;

import java.time.Instant;
import java.util.UUID;

public record OutboxEvent(
    UUID eventId,
    String eventType,
    String aggregateId,
    String payload,
    Instant createdAt,
    boolean published) {
  public static OutboxEvent createTransferCompletedEvent(Transfer transfer) {
    return new OutboxEvent(
        UUID.randomUUID(),
        "TRANSFER_COMPLETED",
        transfer.transferId().toString(),
        """
            {
                "transferId": "%s",
                "sourceWalletId": "%s",
                "destinationWalletId": "%s",
                "amount": %s,
                "currency": "%s",
                "reference": "%s"
            }
            """
            .formatted(
                transfer.transferId(),
                transfer.sourceWalletId(),
                transfer.destinationWalletId(),
                transfer.amount(),
                transfer.currency(),
                transfer.reference()),
        Instant.now(),
        false);
  }

  public OutboxEvent markPublished() {
    return new OutboxEvent(eventId, eventType, aggregateId, payload, createdAt, true);
  }
}
