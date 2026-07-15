package com.kulu.sdet.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

public record TransferRequest(
    @JsonProperty("source_wallet_id") String sourceWalletId,
    @JsonProperty("destination_wallet_id") String destinationWalletId,
    @JsonProperty("amount") Long amount,
    @JsonProperty("currency") String currency,
    @JsonProperty("reference") String reference) {}
