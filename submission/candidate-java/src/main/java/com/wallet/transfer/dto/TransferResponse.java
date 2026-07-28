package com.wallet.transfer.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record TransferResponse(
    UUID transferId,
    String sourceWalletId,
    String destinationWalletId,
    BigDecimal amount,
    String currency,
    String reference,
    String status,
    Instant createdAt) {
  @JsonCreator
  public TransferResponse {}
}
