package com.kulu.sdet.model;

import java.math.BigDecimal;

public final class TransferResponse {

    private final int statusCode;
    private final String transactionId;
    private final String status;
    private final String fromWalletId;
    private final String toWalletId;
    private final BigDecimal amount;
    private final String currency;
    private final String errorMessage;

    private TransferResponse(Builder b) {
        this.statusCode = b.statusCode;
        this.transactionId = b.transactionId;
        this.status = b.status;
        this.fromWalletId = b.fromWalletId;
        this.toWalletId = b.toWalletId;
        this.amount = b.amount;
        this.currency = b.currency;
        this.errorMessage = b.errorMessage;
    }

    public int getStatusCode() {
        return statusCode;
    }

    public String getTransactionId() {
        return transactionId;
    }

    public String getStatus() {
        return status;
    }

    public String getFromWalletId() {
        return fromWalletId;
    }

    public String getToWalletId() {
        return toWalletId;
    }

    public BigDecimal getAmount() {
        return amount;
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
        return "TransferResponse{statusCode=" + statusCode + ", transactionId='" + transactionId + '\'' + ", status='" + status + '\'' + ", error='" + errorMessage + "'}";
    }


    public static final class Builder {
        private int statusCode;
        private String transactionId;
        private String status;
        private String fromWalletId;
        private String toWalletId;
        private BigDecimal amount;
        private String currency;
        private String errorMessage;

        public Builder statusCode(int v) {
            this.statusCode = v;
            return this;
        }

        public Builder transactionId(String v) {
            this.transactionId = v;
            return this;
        }

        public Builder status(String v) {
            this.status = v;
            return this;
        }

        public Builder fromWalletId(String v) {
            this.fromWalletId = v;
            return this;
        }

        public Builder toWalletId(String v) {
            this.toWalletId = v;
            return this;
        }

        public Builder amount(BigDecimal v) {
            this.amount = v;
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

        public TransferResponse build() {
            return new TransferResponse(this);
        }
    }
}
