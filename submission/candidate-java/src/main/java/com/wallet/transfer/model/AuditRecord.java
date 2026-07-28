package com.wallet.transfer.model;

import java.time.Instant;
import java.util.UUID;

public record AuditRecord(
    UUID id, UUID transferId, String action, String details, Instant timestamp) {
  public static AuditRecord createTransferAudit(Transfer transfer) {
    return new AuditRecord(
        UUID.randomUUID(),
        transfer.transferId(),
        "TRANSFER_CREATED",
        "Transfer from %s to %s of %s %s"
            .formatted(
                transfer.sourceWalletId(),
                transfer.destinationWalletId(),
                transfer.amount(),
                transfer.currency()),
        Instant.now());
  }

  public static AuditRecord createDebitAudit(Wallet wallet, Transfer transfer) {
    return new AuditRecord(
        UUID.randomUUID(),
        transfer.transferId(),
        "DEBIT",
        "Wallet %s debited %s %s. New balance: %s"
            .formatted(wallet.walletId(), transfer.amount(), transfer.currency(), wallet.balance()),
        Instant.now());
  }

  public static AuditRecord createCreditAudit(Wallet wallet, Transfer transfer) {
    return new AuditRecord(
        UUID.randomUUID(),
        transfer.transferId(),
        "CREDIT",
        "Wallet %s credited %s %s. New balance: %s"
            .formatted(wallet.walletId(), transfer.amount(), transfer.currency(), wallet.balance()),
        Instant.now());
  }

  public static AuditRecord createFailedAudit(Transfer transfer, String reason) {
    return new AuditRecord(
        UUID.randomUUID(),
        transfer.transferId(),
        "TRANSFER_FAILED",
        "Transfer failed: %s".formatted(reason),
        Instant.now());
  }
}
