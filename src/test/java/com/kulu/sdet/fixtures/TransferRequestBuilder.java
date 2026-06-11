package com.kulu.sdet.fixtures;

import com.kulu.sdet.model.TransferRequest;

import java.math.BigDecimal;

public final class TransferRequestBuilder {

    private String fromWalletId = WalletFixtures.WALLET_ALPHA;
    private String toWalletId = WalletFixtures.WALLET_BETA;
    private BigDecimal amount = WalletFixtures.SMALL_TRANSFER;
    private String currency = "USD";
    private String idempotencyKey = IdempotencyKeyGenerator.random();

    private TransferRequestBuilder() {
    }


    public static TransferRequestBuilder aValidTransfer() {
        return new TransferRequestBuilder();
    }


    public static TransferRequestBuilder withInsufficientFunds() {
        return new TransferRequestBuilder().withAmount(WalletFixtures.OVER_LIMIT);
    }


    public static TransferRequestBuilder withMissingToWallet() {
        return new TransferRequestBuilder().withToWalletId(null);
    }


    public static TransferRequestBuilder withNegativeAmount() {
        return new TransferRequestBuilder().withAmount("-1.00");
    }


    public static TransferRequestBuilder withZeroAmount() {
        return new TransferRequestBuilder().withAmount(BigDecimal.ZERO);
    }


    public static TransferRequestBuilder withUnknownSender() {
        return new TransferRequestBuilder().withFromWalletId("non-existent-" + java.util.UUID.randomUUID());
    }


    public static TransferRequestBuilder withInvalidCurrency() {
        return new TransferRequestBuilder().withCurrency("MOON");
    }


    public static TransferRequestBuilder withSameSourceAndDestination() {
        return new TransferRequestBuilder()
                .withFromWalletId(WalletFixtures.WALLET_ALPHA)
                .withToWalletId(WalletFixtures.WALLET_ALPHA);
    }


    public static TransferRequestBuilder withoutIdempotencyKey() {
        TransferRequestBuilder b = new TransferRequestBuilder();
        b.idempotencyKey = null;
        return b;
    }


    public TransferRequestBuilder withFromWalletId(String fromWalletId) {
        this.fromWalletId = fromWalletId;
        return this;
    }

    public TransferRequestBuilder withToWalletId(String toWalletId) {
        this.toWalletId = toWalletId;
        return this;
    }

    public TransferRequestBuilder withAmount(BigDecimal amount) {
        this.amount = amount;
        return this;
    }

    public TransferRequestBuilder withAmount(String amount) {
        this.amount = new BigDecimal(amount);
        return this;
    }

    public TransferRequestBuilder withCurrency(String currency) {
        this.currency = currency;
        return this;
    }


    public TransferRequestBuilder withKey(String idempotencyKey) {
        this.idempotencyKey = idempotencyKey;
        return this;
    }


    public TransferRequestBuilder withFreshKey() {
        this.idempotencyKey = IdempotencyKeyGenerator.random();
        return this;
    }


    public TransferRequest build() {
        return new TransferRequest.Builder()
                .from(fromWalletId)
                .to(toWalletId)
                .amount(amount)
                .currency(currency)
                .idempotencyKey(idempotencyKey)
                .build();
    }
}
