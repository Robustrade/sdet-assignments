package com.wallet.builders;

import com.wallet.model.TransferRequest;

import java.math.BigDecimal;

/**
 * Builder for TransferRequest objects.
 * Defaults to Alice → Bob, 500 AED so tests only need to override what's relevant.
 */
public class TransferRequestBuilder {

    // defaults that make most tests work without extra setup
    private String sourceWalletId      = "wallet_alice";
    private String destinationWalletId = "wallet_bob";
    private BigDecimal amount          = BigDecimal.valueOf(500);
    private String currency            = "AED";
    // nano time keeps references unique even when multiple builders run in parallel
    private String reference           = "test-ref-" + System.nanoTime();

    // static factory — reads nicer as `aTransfer().from(...)`
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

    // used to test missing source validation
    public TransferRequestBuilder withNullSource() {
        this.sourceWalletId = null;
        return this;
    }

    // used to test missing destination validation
    public TransferRequestBuilder withNullDestination() {
        this.destinationWalletId = null;
        return this;
    }

    // sets destination to same as source — tests the self-transfer rejection
    public TransferRequestBuilder withSameSourceAndDestination() {
        this.destinationWalletId = this.sourceWalletId;
        return this;
    }

    public TransferRequest build() {
        // just wire everything into the model object
        TransferRequest req = new TransferRequest();
        req.setSourceWalletId(sourceWalletId);
        req.setDestinationWalletId(destinationWalletId);
        req.setAmount(amount);
        req.setCurrency(currency);
        req.setReference(reference);
        return req;
    }
}
