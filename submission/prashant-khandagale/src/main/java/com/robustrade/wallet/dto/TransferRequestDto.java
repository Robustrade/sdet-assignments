package com.robustrade.wallet.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

public class TransferRequestDto {

    @JsonProperty("source_wallet_id")
    public String sourceWalletId;

    @JsonProperty("destination_wallet_id")
    public String destinationWalletId;

    @JsonProperty("amount")
    public BigDecimal amount;

    @JsonProperty("currency")
    public String currency;

    @JsonProperty("reference")
    public String reference;

    /** Builds a stable string used for idempotency hashing -- field order never matters. */
    public String canonicalForm() {
        return "src=" + sourceWalletId
                + "|dst=" + destinationWalletId
                + "|amount=" + (amount == null ? "null" : amount.stripTrailingZeros().toPlainString())
                + "|currency=" + currency
                + "|reference=" + reference;
    }
}
