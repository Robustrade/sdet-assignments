package com.wallet.transfer.builders;

import com.wallet.transfer.model.Wallet;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public class WalletBuilder {
  private String walletId = UUID.randomUUID().toString();
  private BigDecimal balance = new BigDecimal("10000.00");
  private String currency = "INR";
  private Instant createdAt = Instant.now();
  private Instant updatedAt = Instant.now();

  public WalletBuilder withWalletId(String walletId) {
    this.walletId = walletId;
    return this;
  }

  public WalletBuilder withBalance(BigDecimal balance) {
    this.balance = balance;
    return this;
  }

  public WalletBuilder withCurrency(String currency) {
    this.currency = currency;
    return this;
  }

  public WalletBuilder withCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  public WalletBuilder withUpdatedAt(Instant updatedAt) {
    this.updatedAt = updatedAt;
    return this;
  }

  public Wallet build() {
    return new Wallet(walletId, balance, currency, createdAt, updatedAt);
  }

  public static WalletBuilder aWallet() {
    return new WalletBuilder();
  }

  public static WalletBuilder aWalletWithBalance(BigDecimal balance) {
    return new WalletBuilder().withBalance(balance);
  }

  public static WalletBuilder wallet(String walletId, BigDecimal balance) {
    return new WalletBuilder().withWalletId(walletId).withBalance(balance);
  }
}
