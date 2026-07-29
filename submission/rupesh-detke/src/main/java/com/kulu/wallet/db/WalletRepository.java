package com.kulu.wallet.db;

import com.kulu.wallet.domain.Wallet;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;

public class WalletRepository {

  public void insert(Connection connection, Wallet wallet) throws SQLException {
    String sql = "INSERT INTO wallets (id, currency, balance, version) VALUES (?, ?, ?, ?)";
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, wallet.id());
      ps.setString(2, wallet.currency());
      ps.setLong(3, wallet.balance());
      ps.setLong(4, wallet.version());
      ps.executeUpdate();
    }
  }

  public Optional<Wallet> findByIdForUpdate(Connection connection, String walletId)
      throws SQLException {
    String sql = "SELECT id, currency, balance, version FROM wallets WHERE id = ? FOR UPDATE";
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, walletId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(
            new Wallet(
                rs.getString("id"),
                rs.getString("currency"),
                rs.getLong("balance"),
                rs.getLong("version")));
      }
    }
  }

  public Optional<Wallet> findById(Connection connection, String walletId) throws SQLException {
    String sql = "SELECT id, currency, balance, version FROM wallets WHERE id = ?";
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, walletId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(
            new Wallet(
                rs.getString("id"),
                rs.getString("currency"),
                rs.getLong("balance"),
                rs.getLong("version")));
      }
    }
  }

  public void updateBalance(
      Connection connection, String walletId, long newBalance, long expectedVersion)
      throws SQLException {
    String sql =
        "UPDATE wallets SET balance = ?, version = version + 1 WHERE id = ? AND version = ?";
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setLong(1, newBalance);
      ps.setString(2, walletId);
      ps.setLong(3, expectedVersion);
      int updated = ps.executeUpdate();
      if (updated != 1) {
        throw new SQLException("Optimistic lock failure updating wallet " + walletId);
      }
    }
  }
}
