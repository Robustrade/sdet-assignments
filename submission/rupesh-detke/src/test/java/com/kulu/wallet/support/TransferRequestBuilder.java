package com.kulu.wallet.support;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public final class TransferRequestBuilder {
  private String sourceWalletId = "wallet_001";
  private String destinationWalletId = "wallet_002";
  private long amount = 2500;
  private String currency = "AED";
  private String reference = "invoice_" + UUID.randomUUID();

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

  public Map<String, Object> build() {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", sourceWalletId);
    body.put("destination_wallet_id", destinationWalletId);
    body.put("amount", amount);
    body.put("currency", currency);
    body.put("reference", reference);
    return body;
  }
}
