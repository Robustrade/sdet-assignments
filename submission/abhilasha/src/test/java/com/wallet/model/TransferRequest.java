package com.wallet.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

// Required fields always serialize (ALWAYS). Optional `reference` omitted when null (NON_NULL).
// Class-level ALWAYS + field-level NON_NULL on reference gives us explicit, per-field control.
public class TransferRequest {

    @JsonProperty("source_wallet_id")
    private String sourceWalletId;

    @JsonProperty("destination_wallet_id")
    private String destinationWalletId;

    @JsonProperty("amount")
    private BigDecimal amount;

    @JsonProperty("currency")
    private String currency;

    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonProperty("reference")
    private String reference;

    public TransferRequest() {}

    private TransferRequest(Builder builder) {
        this.sourceWalletId = builder.sourceWalletId;
        this.destinationWalletId = builder.destinationWalletId;
        this.amount = builder.amount;
        this.currency = builder.currency;
        this.reference = builder.reference;
    }

    public String getSourceWalletId() { return sourceWalletId; }
    public String getDestinationWalletId() { return destinationWalletId; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public String getReference() { return reference; }

    public void setSourceWalletId(String sourceWalletId) { this.sourceWalletId = sourceWalletId; }
    public void setDestinationWalletId(String destinationWalletId) { this.destinationWalletId = destinationWalletId; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }
    public void setCurrency(String currency) { this.currency = currency; }
    public void setReference(String reference) { this.reference = reference; }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String sourceWalletId;
        private String destinationWalletId;
        private BigDecimal amount;
        private String currency;
        private String reference;

        public Builder sourceWalletId(String sourceWalletId) {
            this.sourceWalletId = sourceWalletId;
            return this;
        }

        public Builder destinationWalletId(String destinationWalletId) {
            this.destinationWalletId = destinationWalletId;
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

        public Builder reference(String reference) {
            this.reference = reference;
            return this;
        }

        public TransferRequest build() {
            return new TransferRequest(this);
        }
    }
}
