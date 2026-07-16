package com.wallet.transfer.model;

import java.math.BigDecimal;
import java.time.Instant;

public record Wallet(
    String walletId, BigDecimal balance, String currency, Instant createdAt, Instant updatedAt) {
  public Wallet debit(BigDecimal amount) {
    return new Wallet(walletId, balance.subtract(amount), currency, createdAt, Instant.now());
  }

  public Wallet credit(BigDecimal amount) {
    return new Wallet(walletId, balance.add(amount), currency, createdAt, Instant.now());
  }

  public boolean hasSufficientBalance(BigDecimal amount) {
    return balance.compareTo(amount) >= 0;
  }
}
