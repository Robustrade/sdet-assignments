package com.wallet.builders;

import com.wallet.db.WalletRepository;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Fluent builder for creating wallet test fixtures directly in the DB.
 */
public class WalletBuilder {

    private String id          = "wallet_" + UUID.randomUUID().toString().replace("-","").substring(0, 8);
    private String ownerName   = "Test User";
    private BigDecimal balance = BigDecimal.valueOf(10_000);
    private String currency    = "AED";

    private final WalletRepository repo;

    public WalletBuilder(WalletRepository repo) {
        this.repo = repo;
    }

    public static WalletBuilder aWallet(WalletRepository repo) {
        return new WalletBuilder(repo);
    }

    public WalletBuilder withId(String id) {
        this.id = id;
        return this;
    }

    public WalletBuilder withOwner(String name) {
        this.ownerName = name;
        return this;
    }

    public WalletBuilder withBalance(double balance) {
        this.balance = BigDecimal.valueOf(balance);
        return this;
    }

    public WalletBuilder withBalance(BigDecimal balance) {
        this.balance = balance;
        return this;
    }

    public WalletBuilder withCurrency(String currency) {
        this.currency = currency;
        return this;
    }

    public WalletBuilder withZeroBalance() {
        this.balance = BigDecimal.ZERO;
        return this;
    }

    /** Persists the wallet and returns its id. */
    public String create() {
        repo.upsert(id, ownerName, balance, currency);
        return id;
    }

    public String getId() {
        return id;
    }
}

