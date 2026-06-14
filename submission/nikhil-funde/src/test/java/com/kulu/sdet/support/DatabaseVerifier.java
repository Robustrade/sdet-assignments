package com.kulu.sdet.support;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import org.assertj.core.api.Assertions;

public class DatabaseVerifier {

  private final Connection connection;

  public DatabaseVerifier(Connection connection) {
    this.connection = connection;
  }

  public long getBalance(String walletId) throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement("SELECT balance FROM wallets WHERE id = ?")) {
      stmt.setString(1, walletId);
      try (ResultSet rs = stmt.executeQuery()) {
        Assertions.assertThat(rs.next()).isTrue();
        return rs.getLong("balance");
      }
    }
  }

  public void assertBalance(String walletId, long expectedBalance) throws SQLException {
    Assertions.assertThat(getBalance(walletId)).isEqualTo(expectedBalance);
  }

  public int getTransferCount() throws SQLException {
    return countRows("transfers");
  }

  public void assertTransferCount(int expected) throws SQLException {
    Assertions.assertThat(getTransferCount()).isEqualTo(expected);
  }

  public int getAuditEventCount() throws SQLException {
    return countRows("audit_events");
  }

  public void assertAuditEventCount(int expected) throws SQLException {
    Assertions.assertThat(getAuditEventCount()).isEqualTo(expected);
  }

  public int getOutboxEventCount() throws SQLException {
    return countRows("outbox_events");
  }

  public void assertOutboxEventCount(int expected) throws SQLException {
    Assertions.assertThat(getOutboxEventCount()).isEqualTo(expected);
  }

  public void assertTransferRow(String transferId, String status, long amount) throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement("SELECT status, amount FROM transfers WHERE id = ?")) {
      stmt.setString(1, transferId);
      try (ResultSet rs = stmt.executeQuery()) {
        Assertions.assertThat(rs.next()).isTrue();
        Assertions.assertThat(rs.getString("status")).isEqualTo(status);
        Assertions.assertThat(rs.getLong("amount")).isEqualTo(amount);
      }
    }
  }

  public void assertAuditEventForTransfer(String transferId, String eventType) throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement("SELECT event_type FROM audit_events WHERE transfer_id = ?")) {
      stmt.setString(1, transferId);
      try (ResultSet rs = stmt.executeQuery()) {
        Assertions.assertThat(rs.next()).isTrue();
        Assertions.assertThat(rs.getString("event_type")).isEqualTo(eventType);
      }
    }
  }

  public void assertNoSideEffects() throws SQLException {
    assertTransferCount(0);
    assertAuditEventCount(0);
    assertOutboxEventCount(0);
    assertBalance("wallet_001", 10000);
    assertBalance("wallet_002", 5000);
  }

  private int countRows(String table) throws SQLException {
    try (PreparedStatement stmt =
            connection.prepareStatement("SELECT COUNT(*) AS cnt FROM " + table);
        ResultSet rs = stmt.executeQuery()) {
      rs.next();
      return rs.getInt("cnt");
    }
  }
}
