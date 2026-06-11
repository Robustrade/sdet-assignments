package com.kulu.sdet.model;

import java.math.BigDecimal;

public final class Wallet {

    private final String id;
    private final String ownerId;
    private final BigDecimal balance;
    private final String currency;

    Wallet(String id, String ownerId, BigDecimal balance, String currency) {
        this.id = id;
        this.ownerId = ownerId;
        this.balance = balance;
        this.currency = currency;
    }

    public String getId() {
        return id;
    }

    public String getOwnerId() {
        return ownerId;
    }

    public BigDecimal getBalance() {
        return balance;
    }

    public String getCurrency() {
        return currency;
    }


    public Object[] toInsertArgs() {
        return new Object[]{id, ownerId, balance, currency};
    }

    @Override
    public String toString() {
        return "Wallet{id='" + id + "', ownerId='" + ownerId + "', balance=" + balance + ", currency='" + currency + "'}";
    }
}
