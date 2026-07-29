package com.kulu.wallet.db;

import com.kulu.wallet.domain.Transfer;
import com.kulu.wallet.domain.TransferStatus;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

public class TransferRepository {

  public void insert(Connection connection, Transfer transfer) throws SQLException {
    String sql =
        """
        INSERT INTO transfers
          (id, source_wallet_id, destination_wallet_id, amount, currency, reference, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """;
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, transfer.id());
      ps.setString(2, transfer.sourceWalletId());
      ps.setString(3, transfer.destinationWalletId());
      ps.setLong(4, transfer.amount());
      ps.setString(5, transfer.currency());
      ps.setString(6, transfer.reference());
      ps.setString(7, transfer.status().name());
      ps.setTimestamp(8, Timestamp.from(transfer.createdAt()));
      ps.executeUpdate();
    }
  }

  public Optional<Transfer> findById(Connection connection, String transferId) throws SQLException {
    String sql =
        """
        SELECT id, source_wallet_id, destination_wallet_id, amount, currency, reference, status, created_at
        FROM transfers WHERE id = ?
        """;
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, transferId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(map(rs));
      }
    }
  }

  public long countAll(Connection connection) throws SQLException {
    try (PreparedStatement ps = connection.prepareStatement("SELECT COUNT(*) FROM transfers");
        ResultSet rs = ps.executeQuery()) {
      rs.next();
      return rs.getLong(1);
    }
  }

  private static Transfer map(ResultSet rs) throws SQLException {
    Instant createdAt = rs.getTimestamp("created_at").toInstant();
    return new Transfer(
        rs.getString("id"),
        rs.getString("source_wallet_id"),
        rs.getString("destination_wallet_id"),
        rs.getLong("amount"),
        rs.getString("currency"),
        rs.getString("reference"),
        TransferStatus.valueOf(rs.getString("status")),
        createdAt);
  }
}
