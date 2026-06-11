package com.kulu.sdet.model;

import java.math.BigDecimal;

public final class TransferRequest {

    private final String fromWalletId;
    private final String toWalletId;
    private final BigDecimal amount;
    private final String currency;
    private final String idempotencyKey;

    private TransferRequest(Builder b) {
        this.fromWalletId = b.fromWalletId;
        this.toWalletId = b.toWalletId;
        this.amount = b.amount;
        this.currency = b.currency;
        this.idempotencyKey = b.idempotencyKey;
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

    public String getIdempotencyKey() {
        return idempotencyKey;
    }


    public java.util.Map<String, Object> toMap() {
        java.util.Map<String, Object> map = new java.util.LinkedHashMap<>();
        if (fromWalletId != null) map.put("fromWalletId", fromWalletId);
        if (toWalletId != null) map.put("toWalletId", toWalletId);
        if (amount != null) map.put("amount", amount.toPlainString());
        if (currency != null) map.put("currency", currency);
        if (idempotencyKey != null) map.put("idempotencyKey", idempotencyKey);
        return map;
    }


    public static final class Builder {
        private String fromWalletId;
        private String toWalletId;
        private BigDecimal amount;
        private String currency = "USD";
        private String idempotencyKey;

        public Builder from(String fromWalletId) {
            this.fromWalletId = fromWalletId;
            return this;
        }

        public Builder to(String toWalletId) {
            this.toWalletId = toWalletId;
            return this;
        }

        public Builder amount(BigDecimal amount) {
            this.amount = amount;
            return this;
        }

        public Builder amount(String amount) {
            this.amount = new BigDecimal(amount);
            return this;
        }

        public Builder currency(String currency) {
            this.currency = currency;
            return this;
        }

        public Builder idempotencyKey(String key) {
            this.idempotencyKey = key;
            return this;
        }

        public TransferRequest build() {
            return new TransferRequest(this);
        }
    }
}
