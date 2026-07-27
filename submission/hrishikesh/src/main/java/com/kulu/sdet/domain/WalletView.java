package com.kulu.sdet.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

public record WalletView(
    @JsonProperty("id") String id,
    @JsonProperty("balance") long balance,
    @JsonProperty("currency") String currency) {}
