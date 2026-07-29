package com.kulu.wallet.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

public record TransferRequest(
    @JsonProperty("source_wallet_id") String sourceWalletId,
    @JsonProperty("destination_wallet_id") String destinationWalletId,
    long amount,
    String currency,
    String reference) {}
