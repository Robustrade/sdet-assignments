package com.kulu.sdet.support.builders;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Fluent builder for transfer request bodies. Keeps scenario code free from noisy map plumbing and
 * makes the "one axis at a time" test style easy to read.
 */
public final class TransferRequestBuilder {

  private String sourceWalletId = "wallet_source";
  private String destinationWalletId = "wallet_dest";
  private Long amount = 1000L;
  private String currency = "AED";
  private String reference = "test_ref";
  private boolean includeAmount = true;
  private boolean includeCurrency = true;
  private boolean includeSource = true;
  private boolean includeDestination = true;
  private boolean includeReference = true;

  public static TransferRequestBuilder aTransfer() {
    return new TransferRequestBuilder();
  }

  public TransferRequestBuilder from(String source) {
    this.sourceWalletId = source;
    return this;
  }

  public TransferRequestBuilder to(String destination) {
    this.destinationWalletId = destination;
    return this;
  }

  public TransferRequestBuilder ofAmount(long amount) {
    this.amount = amount;
    return this;
  }

  public TransferRequestBuilder inCurrency(String currency) {
    this.currency = currency;
    return this;
  }

  public TransferRequestBuilder withReference(String reference) {
    this.reference = reference;
    return this;
  }

  public TransferRequestBuilder withoutAmount() {
    this.includeAmount = false;
    return this;
  }

  public TransferRequestBuilder withoutCurrency() {
    this.includeCurrency = false;
    return this;
  }

  public TransferRequestBuilder withoutSource() {
    this.includeSource = false;
    return this;
  }

  public TransferRequestBuilder withoutDestination() {
    this.includeDestination = false;
    return this;
  }

  public TransferRequestBuilder withoutReference() {
    this.includeReference = false;
    return this;
  }

  public Map<String, Object> build() {
    Map<String, Object> body = new LinkedHashMap<>();
    if (includeSource) {
      body.put("source_wallet_id", sourceWalletId);
    }
    if (includeDestination) {
      body.put("destination_wallet_id", destinationWalletId);
    }
    if (includeAmount) {
      body.put("amount", amount);
    }
    if (includeCurrency) {
      body.put("currency", currency);
    }
    if (includeReference) {
      body.put("reference", reference);
    }
    return body;
  }
}
