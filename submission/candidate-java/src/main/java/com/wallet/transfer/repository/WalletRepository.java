package com.wallet.transfer.repository;

import com.wallet.transfer.model.Wallet;
import java.math.BigDecimal;
import java.util.Optional;

public interface WalletRepository {
  Wallet save(Wallet wallet);

  Optional<Wallet> findById(String walletId);

  boolean existsById(String walletId);

  void deleteById(String walletId);

  boolean updateBalance(String walletId, BigDecimal expectedBalance, BigDecimal newBalance);
}
