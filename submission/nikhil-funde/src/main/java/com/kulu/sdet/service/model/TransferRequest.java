package com.kulu.sdet.service.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class TransferRequest {
  @JsonProperty("source_wallet_id")
  public String sourceWalletId;

  @JsonProperty("destination_wallet_id")
  public String destinationWalletId;

  public Long amount;
  public String currency;
  public String reference;

  public TransferRequest() {}

  public TransferRequest(
      String sourceWalletId,
      String destinationWalletId,
      Long amount,
      String currency,
      String reference) {
    this.sourceWalletId = sourceWalletId;
    this.destinationWalletId = destinationWalletId;
    this.amount = amount;
    this.currency = currency;
    this.reference = reference;
  }
}
