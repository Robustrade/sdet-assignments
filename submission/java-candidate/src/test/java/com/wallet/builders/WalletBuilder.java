package com.wallet.builders;

import com.wallet.db.WalletRepository;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Creates wallet rows directly in the DB for tests that need their own isolated wallets.
 * Generates a random id by default so multiple wallets in the same test don't clash.
 */
public class WalletBuilder {

    // random suffix so IDs don't collide even when many wallets are created in the same test run
    private String id          = "wallet_" + UUID.randomUUID().toString().replace("-","").substring(0, 8);
    private String ownerName   = "Test User";
    private BigDecimal balance = BigDecimal.valueOf(10_000);
    private String currency    = "AED";

    private final WalletRepository repo;

    public WalletBuilder(WalletRepository repo) {
        this.repo = repo;
    }

    // static factory for fluent usage: WalletBuilder.aWallet(repo).withBalance(...)
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

    // shorthand when you just need an empty wallet
    public WalletBuilder withZeroBalance() {
        this.balance = BigDecimal.ZERO;
        return this;
    }

    /** Writes the wallet to the DB and returns the generated id. */
    public String create() {
        // upsert so re-running tests doesn't throw duplicate key errors
        repo.upsert(id, ownerName, balance, currency);
        return id;
    }

    public String getId() {
        return id;
    }
}

