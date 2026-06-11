package com.kulu.sdet.fixtures;

import com.kulu.sdet.model.Wallet;

import java.math.BigDecimal;
import java.util.UUID;

public final class WalletBuilder {


    private String id = UUID.randomUUID().toString();
    private String ownerId = "owner-" + UUID.randomUUID().toString().substring(0, 8);
    private BigDecimal balance = WalletFixtures.DEFAULT_BALANCE;
    private String currency = "USD";

    private WalletBuilder() {
    }


    public static WalletBuilder aWallet() {
        return new WalletBuilder();
    }


    public static WalletBuilder anEmptyWallet() {
        return new WalletBuilder().withBalance(BigDecimal.ZERO);
    }


    public static WalletBuilder anAlphaWallet() {
        return new WalletBuilder().withId(WalletFixtures.WALLET_ALPHA);
    }


    public static WalletBuilder aBetaWallet() {
        return new WalletBuilder().withId(WalletFixtures.WALLET_BETA);
    }


    public WalletBuilder withId(String id) {
        this.id = id;
        return this;
    }

    public WalletBuilder withOwnerId(String ownerId) {
        this.ownerId = ownerId;
        return this;
    }

    public WalletBuilder withBalance(BigDecimal balance) {
        this.balance = balance;
        return this;
    }

    public WalletBuilder withBalance(String balance) {
        this.balance = new BigDecimal(balance);
        return this;
    }

    public WalletBuilder withCurrency(String currency) {
        this.currency = currency;
        return this;
    }


    public Wallet build() {
        if (id == null || id.isBlank()) throw new IllegalStateException("Wallet id must not be blank");
        if (ownerId == null || ownerId.isBlank()) throw new IllegalStateException("Wallet ownerId must not be blank");
        return new Wallet(id, ownerId, balance, currency);
    }
}
