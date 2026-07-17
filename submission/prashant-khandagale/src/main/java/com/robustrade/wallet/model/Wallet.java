package com.robustrade.wallet.model;

import java.math.BigDecimal;

/**
 * A wallet holds a balance in a single currency.
 * This is a plain data holder -- all persistence lives in WalletDao.
 */
public class Wallet {

    private final String id;
    private final String currency;
    private final BigDecimal balance;

    public Wallet(String id, String currency, BigDecimal balance) {
        this.id = id;
        this.currency = currency;
        this.balance = balance;
    }

    public String getId() {
        return id;
    }

    public String getCurrency() {
        return currency;
    }

    public BigDecimal getBalance() {
        return balance;
    }
}
