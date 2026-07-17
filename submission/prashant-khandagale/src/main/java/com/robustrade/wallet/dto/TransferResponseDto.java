package com.robustrade.wallet.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class TransferResponseDto {

    @JsonProperty("transfer_id")
    public String transferId;

    @JsonProperty("status")
    public String status;

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

    @JsonProperty("rejection_reason")
    public String rejectionReason;

    @JsonProperty("created_at")
    public String createdAt;

    /** True when this response was served from the idempotency store rather than freshly processed. */
    @JsonProperty("replayed")
    public boolean replayed;
}
