package com.robustrade.wallet.model;

import java.math.BigDecimal;
import java.time.Instant;

public class Transfer {

    private final String id;
    private final String sourceWalletId;
    private final String destinationWalletId;
    private final BigDecimal amount;
    private final String currency;
    private final String reference;
    private final TransferStatus status;
    private final String rejectionReason; // null unless status == REJECTED
    private final Instant createdAt;

    public Transfer(String id, String sourceWalletId, String destinationWalletId,
                     BigDecimal amount, String currency, String reference,
                     TransferStatus status, String rejectionReason, Instant createdAt) {
        this.id = id;
        this.sourceWalletId = sourceWalletId;
        this.destinationWalletId = destinationWalletId;
        this.amount = amount;
        this.currency = currency;
        this.reference = reference;
        this.status = status;
        this.rejectionReason = rejectionReason;
        this.createdAt = createdAt;
    }

    public String getId() { return id; }
    public String getSourceWalletId() { return sourceWalletId; }
    public String getDestinationWalletId() { return destinationWalletId; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public String getReference() { return reference; }
    public TransferStatus getStatus() { return status; }
    public String getRejectionReason() { return rejectionReason; }
    public Instant getCreatedAt() { return createdAt; }
}
