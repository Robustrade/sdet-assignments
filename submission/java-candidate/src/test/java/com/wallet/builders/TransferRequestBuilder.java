package com.wallet.builders;

import com.wallet.model.TransferRequest;

import java.math.BigDecimal;

/**
 * Fluent builder for TransferRequest test data.
 * Provides sensible defaults so tests only specify what they care about.
 */
public class TransferRequestBuilder {

    private String sourceWalletId      = "wallet_alice";
    private String destinationWalletId = "wallet_bob";
    private BigDecimal amount          = BigDecimal.valueOf(500);
    private String currency            = "AED";
    private String reference           = "test-ref-" + System.nanoTime();

    public static TransferRequestBuilder aTransfer() {
        return new TransferRequestBuilder();
    }

    public TransferRequestBuilder from(String sourceWalletId) {
        this.sourceWalletId = sourceWalletId;
        return this;
    }

    public TransferRequestBuilder to(String destinationWalletId) {
        this.destinationWalletId = destinationWalletId;
        return this;
    }

    public TransferRequestBuilder amount(double amount) {
        this.amount = BigDecimal.valueOf(amount);
        return this;
    }

    public TransferRequestBuilder amount(BigDecimal amount) {
        this.amount = amount;
        return this;
    }

    public TransferRequestBuilder currency(String currency) {
        this.currency = currency;
        return this;
    }

    public TransferRequestBuilder reference(String reference) {
        this.reference = reference;
        return this;
    }

    public TransferRequestBuilder withNullSource() {
        this.sourceWalletId = null;
        return this;
    }

    public TransferRequestBuilder withNullDestination() {
        this.destinationWalletId = null;
        return this;
    }

    public TransferRequestBuilder withSameSourceAndDestination() {
        this.destinationWalletId = this.sourceWalletId;
        return this;
    }

    public TransferRequest build() {
        TransferRequest req = new TransferRequest();
        req.setSourceWalletId(sourceWalletId);
        req.setDestinationWalletId(destinationWalletId);
        req.setAmount(amount);
        req.setCurrency(currency);
        req.setReference(reference);
        return req;
    }
}

