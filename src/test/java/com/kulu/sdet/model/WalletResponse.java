package com.kulu.sdet.model;

import java.math.BigDecimal;

public final class WalletResponse {

    private final int statusCode;
    private final String id;
    private final String ownerId;
    private final BigDecimal balance;
    private final String currency;
    private final String errorMessage;

    private WalletResponse(Builder b) {
        this.statusCode = b.statusCode;
        this.id = b.id;
        this.ownerId = b.ownerId;
        this.balance = b.balance;
        this.currency = b.currency;
        this.errorMessage = b.errorMessage;
    }

    public int getStatusCode() {
        return statusCode;
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

    public String getErrorMessage() {
        return errorMessage;
    }

    public boolean isSuccess() {
        return statusCode >= 200 && statusCode < 300;
    }

    @Override
    public String toString() {
        return "WalletResponse{statusCode=" + statusCode + ", id='" + id + '\'' + ", balance=" + balance + ", currency='" + currency + "'}";
    }


    public static final class Builder {
        private int statusCode;
        private String id;
        private String ownerId;
        private BigDecimal balance;
        private String currency;
        private String errorMessage;

        public Builder statusCode(int v) {
            this.statusCode = v;
            return this;
        }

        public Builder id(String v) {
            this.id = v;
            return this;
        }

        public Builder ownerId(String v) {
            this.ownerId = v;
            return this;
        }

        public Builder balance(BigDecimal v) {
            this.balance = v;
            return this;
        }

        public Builder currency(String v) {
            this.currency = v;
            return this;
        }

        public Builder errorMessage(String v) {
            this.errorMessage = v;
            return this;
        }

        public WalletResponse build() {
            return new WalletResponse(this);
        }
    }
}
