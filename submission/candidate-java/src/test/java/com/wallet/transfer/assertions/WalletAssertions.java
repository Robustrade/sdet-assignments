package com.wallet.transfer.assertions;

import com.wallet.transfer.dto.WalletResponse;
import com.wallet.transfer.model.Wallet;
import com.wallet.transfer.repository.WalletRepository;
import java.math.BigDecimal;
import org.assertj.core.api.Assertions;

public class WalletAssertions {
  private final WalletRepository walletRepository;

  public WalletAssertions(WalletRepository walletRepository) {
    this.walletRepository = walletRepository;
  }

  public void assertWalletExists(String walletId) {
    Wallet wallet =
        walletRepository
            .findById(walletId)
            .orElseThrow(() -> new AssertionError("Wallet not found: " + walletId));
    Assertions.assertThat(wallet).isNotNull();
  }

  public void assertWalletBalance(String walletId, BigDecimal expectedBalance) {
    Wallet wallet =
        walletRepository
            .findById(walletId)
            .orElseThrow(() -> new AssertionError("Wallet not found: " + walletId));

    Assertions.assertThat(wallet.balance())
        .as("Wallet %s balance", walletId)
        .isEqualByComparingTo(expectedBalance);
  }

  public void assertWalletCurrency(String walletId, String expectedCurrency) {
    Wallet wallet =
        walletRepository
            .findById(walletId)
            .orElseThrow(() -> new AssertionError("Wallet not found: " + walletId));

    Assertions.assertThat(wallet.currency())
        .as("Wallet %s currency", walletId)
        .isEqualTo(expectedCurrency);
  }

  public void assertWalletResponseMatches(WalletResponse response, String walletId) {
    Wallet wallet =
        walletRepository
            .findById(walletId)
            .orElseThrow(() -> new AssertionError("Wallet not found: " + walletId));

    Assertions.assertThat(response.walletId().toString()).isEqualTo(walletId);
    Assertions.assertThat(response.balance()).isEqualByComparingTo(wallet.balance());
    Assertions.assertThat(response.currency()).isEqualTo(wallet.currency());
  }

  public static WalletAssertions with(WalletRepository walletRepository) {
    return new WalletAssertions(walletRepository);
  }
}
