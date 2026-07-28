package com.wallet.transfer.repository;

import com.wallet.transfer.model.Wallet;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

public class InMemoryWalletRepository implements WalletRepository {
  private final ConcurrentMap<String, Wallet> wallets = new ConcurrentHashMap<>();

  @Override
  public Wallet save(Wallet wallet) {
    wallets.put(wallet.walletId(), wallet);
    return wallet;
  }

  @Override
  public Optional<Wallet> findById(String walletId) {
    return Optional.ofNullable(wallets.get(walletId));
  }

  @Override
  public boolean existsById(String walletId) {
    return wallets.containsKey(walletId);
  }

  @Override
  public void deleteById(String walletId) {
    wallets.remove(walletId);
  }

  public boolean updateBalance(String walletId, BigDecimal expectedBalance, BigDecimal newBalance) {
    Wallet current = wallets.get(walletId);
    if (current == null || current.balance().compareTo(expectedBalance) != 0) {
      return false;
    }
    Wallet updated =
        new Wallet(
            current.walletId(),
            newBalance,
            current.currency(),
            current.createdAt(),
            java.time.Instant.now());
    return wallets.replace(walletId, current, updated);
  }

  public void clear() {
    wallets.clear();
  }
}
