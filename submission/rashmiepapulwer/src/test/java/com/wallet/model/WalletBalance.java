package com.wallet.model;

import java.math.BigDecimal;

public class WalletBalance {

    private final String walletId;
    private final BigDecimal balance;
    private final String currency;
    private final long version;

    public WalletBalance(String walletId, BigDecimal balance, String currency, long version) {
        this.walletId = walletId;
        this.balance = balance;
        this.currency = currency;
        this.version = version;
    }

    public String getWalletId() { return walletId; }
    public BigDecimal getBalance() { return balance; }
    public String getCurrency() { return currency; }
    public long getVersion() { return version; }

    public BigDecimal deltaFrom(WalletBalance other) {
        return this.balance.subtract(other.balance);
    }

    @Override
    public String toString() {
        return String.format("WalletBalance{id=%s, balance=%s %s, version=%d}",
                walletId, balance, currency, version);
    }
}
