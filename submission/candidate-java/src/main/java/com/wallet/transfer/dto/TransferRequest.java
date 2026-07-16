package com.wallet.transfer.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;

public record TransferRequest(
    @JsonProperty("source_wallet_id") String sourceWalletId,
    @JsonProperty("destination_wallet_id") String destinationWalletId,
    @JsonProperty("amount") BigDecimal amount,
    @JsonProperty("currency") String currency,
    @JsonProperty("reference") String reference) {

  @JsonIgnore
  public boolean isValid() {
    return sourceWalletId != null
        && !sourceWalletId.isBlank()
        && destinationWalletId != null
        && !destinationWalletId.isBlank()
        && amount != null
        && amount.compareTo(BigDecimal.ZERO) > 0
        && currency != null
        && !currency.isBlank()
        && reference != null
        && !reference.isBlank();
  }

  @JsonIgnore
  public boolean sameWallet() {
    return sourceWalletId != null && sourceWalletId.equals(destinationWalletId);
  }
}
