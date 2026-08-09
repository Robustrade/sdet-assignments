package com.wallet.model;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public class TransferRecord {

    private final String id;
    private final String sourceWalletId;
    private final String destinationWalletId;
    private final BigDecimal amount;
    private final String currency;
    private final String status;
    private final String reference;
    private final String idempotencyKey;
    private final String failureReason;

    public TransferRecord(String id, String sourceWalletId, String destinationWalletId,
                          BigDecimal amount, String currency, String status,
                          String reference, String idempotencyKey, String failureReason) {
        this.id = id;
        this.sourceWalletId = sourceWalletId;
        this.destinationWalletId = destinationWalletId;
        this.amount = amount;
        this.currency = currency;
        this.status = status;
        this.reference = reference;
        this.idempotencyKey = idempotencyKey;
        this.failureReason = failureReason;
    }

    public String getId() { return id; }
    public String getSourceWalletId() { return sourceWalletId; }
    public String getDestinationWalletId() { return destinationWalletId; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public String getStatus() { return status; }
    public String getReference() { return reference; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public String getFailureReason() { return failureReason; }

    @Override
    public String toString() {
        return String.format("TransferRecord{id=%s, status=%s, amount=%s %s}",
                id, status, amount, currency);
    }
}