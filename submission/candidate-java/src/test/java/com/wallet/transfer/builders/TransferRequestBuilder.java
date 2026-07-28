package com.wallet.transfer.builders;

import com.wallet.transfer.dto.TransferRequest;
import java.math.BigDecimal;

public class TransferRequestBuilder {
  private String sourceWalletId = "wallet_001";
  private String destinationWalletId = "wallet_002";
  private BigDecimal amount = new BigDecimal("100.00");
  private String currency = "INR";
  private String reference = "ref_" + System.currentTimeMillis();

  public TransferRequestBuilder withSourceWalletId(String sourceWalletId) {
    this.sourceWalletId = sourceWalletId;
    return this;
  }

  public TransferRequestBuilder withDestinationWalletId(String destinationWalletId) {
    this.destinationWalletId = destinationWalletId;
    return this;
  }

  public TransferRequestBuilder withAmount(BigDecimal amount) {
    this.amount = amount;
    return this;
  }

  public TransferRequestBuilder withCurrency(String currency) {
    this.currency = currency;
    return this;
  }

  public TransferRequestBuilder withReference(String reference) {
    this.reference = reference;
    return this;
  }

  public TransferRequest build() {
    return new TransferRequest(sourceWalletId, destinationWalletId, amount, currency, reference);
  }

  public static TransferRequestBuilder aTransfer() {
    return new TransferRequestBuilder();
  }

  public static TransferRequestBuilder transfer(
      String source, String destination, BigDecimal amount) {
    return new TransferRequestBuilder()
        .withSourceWalletId(source)
        .withDestinationWalletId(destination)
        .withAmount(amount);
  }

  public static TransferRequestBuilder invalidAmount() {
    return new TransferRequestBuilder().withAmount(BigDecimal.ZERO);
  }

  public static TransferRequestBuilder negativeAmount() {
    return new TransferRequestBuilder().withAmount(new BigDecimal("-100.00"));
  }

  public static TransferRequestBuilder sameWallet() {
    return new TransferRequestBuilder()
        .withSourceWalletId("wallet_001")
        .withDestinationWalletId("wallet_001");
  }

  public static TransferRequestBuilder missingFields() {
    return new TransferRequestBuilder()
        .withSourceWalletId("")
        .withDestinationWalletId("")
        .withAmount(null)
        .withCurrency(null)
        .withReference("");
  }
}
