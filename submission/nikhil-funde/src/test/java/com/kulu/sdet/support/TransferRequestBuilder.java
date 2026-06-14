package com.kulu.sdet.support;

import com.kulu.sdet.service.model.TransferRequest;

public class TransferRequestBuilder {

  private String sourceWalletId = "wallet_001";
  private String destinationWalletId = "wallet_002";
  private Long amount = 1000L;
  private String currency = "AED";
  private String reference;

  public static TransferRequestBuilder aTransfer() {
    return new TransferRequestBuilder();
  }

  public TransferRequestBuilder from(String sourceWalletId) {
    this.sourceWalletId = sourceWalletId;
    return this;
  }

  public TransferRequestBuilder to(String destinationWalletId) {
    this.destinationWalletId = destinationWalletId;
    return this;
  }

  public TransferRequestBuilder amount(long amount) {
    this.amount = amount;
    return this;
  }

  public TransferRequestBuilder currency(String currency) {
    this.currency = currency;
    return this;
  }

  public TransferRequestBuilder reference(String reference) {
    this.reference = reference;
    return this;
  }

  public TransferRequest build() {
    return new TransferRequest(sourceWalletId, destinationWalletId, amount, currency, reference);
  }
}
