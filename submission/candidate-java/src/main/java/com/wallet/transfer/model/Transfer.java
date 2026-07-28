package com.wallet.transfer.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record Transfer(
    UUID transferId,
    String sourceWalletId,
    String destinationWalletId,
    BigDecimal amount,
    String currency,
    String reference,
    String status,
    Instant createdAt,
    Instant updatedAt) {
  public Transfer markCompleted() {
    return new Transfer(
        transferId,
        sourceWalletId,
        destinationWalletId,
        amount,
        currency,
        reference,
        "COMPLETED",
        createdAt,
        Instant.now());
  }

  public Transfer markFailed() {
    return new Transfer(
        transferId,
        sourceWalletId,
        destinationWalletId,
        amount,
        currency,
        reference,
        "FAILED",
        createdAt,
        Instant.now());
  }

  public Transfer markRejected() {
    return new Transfer(
        transferId,
        sourceWalletId,
        destinationWalletId,
        amount,
        currency,
        reference,
        "REJECTED",
        createdAt,
        Instant.now());
  }
}
