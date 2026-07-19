package com.kulu.wallet.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

public record TransferResponse(
    @JsonProperty("transfer_id") String transferId,
    @JsonProperty("source_wallet_id") String sourceWalletId,
    @JsonProperty("destination_wallet_id") String destinationWalletId,
    long amount,
    String currency,
    String reference,
    String status) {

  public static TransferResponse from(Transfer transfer) {
    return new TransferResponse(
        transfer.id(),
        transfer.sourceWalletId(),
        transfer.destinationWalletId(),
        transfer.amount(),
        transfer.currency(),
        transfer.reference(),
        transfer.status().name());
  }
}
