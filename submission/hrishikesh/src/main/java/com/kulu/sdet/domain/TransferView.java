package com.kulu.sdet.domain;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;

public record TransferView(
    @JsonProperty("id") String id,
    @JsonProperty("source_wallet_id") String sourceWalletId,
    @JsonProperty("destination_wallet_id") String destinationWalletId,
    @JsonProperty("amount") long amount,
    @JsonProperty("currency") String currency,
    @JsonProperty("reference") String reference,
    @JsonProperty("status") String status,
    @JsonProperty("idempotency_key") String idempotencyKey,
    @JsonProperty("created_at") Instant createdAt) {}
