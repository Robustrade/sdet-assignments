package com.wallet.transfer.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import java.time.Instant;

public record WalletResponse(
    String walletId, BigDecimal balance, String currency, Instant createdAt) {
  @JsonCreator
  public WalletResponse {}
}
