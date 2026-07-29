package com.kulu.wallet.db;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;

public class IdempotencyRepository {

  public record StoredResponse(
      String requestHash, String transferId, int httpStatus, String responseBody) {}

  public Optional<StoredResponse> find(Connection connection, String idempotencyKey)
      throws SQLException {
    String sql =
        """
        SELECT request_hash, transfer_id, http_status, response_body
        FROM idempotency_keys WHERE idempotency_key = ?
        """;
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, idempotencyKey);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(
            new StoredResponse(
                rs.getString("request_hash"),
                rs.getString("transfer_id"),
                rs.getInt("http_status"),
                rs.getString("response_body")));
      }
    }
  }

  public void insert(
      Connection connection,
      String idempotencyKey,
      String requestHash,
      String transferId,
      int httpStatus,
      String responseBody)
      throws SQLException {
    String sql =
        """
        INSERT INTO idempotency_keys
          (idempotency_key, request_hash, transfer_id, http_status, response_body)
        VALUES (?, ?, ?, ?, ?)
        """;
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, idempotencyKey);
      ps.setString(2, requestHash);
      ps.setString(3, transferId);
      ps.setInt(4, httpStatus);
      ps.setString(5, responseBody);
      ps.executeUpdate();
    }
  }

  public long countAll(Connection connection) throws SQLException {
    try (PreparedStatement ps =
            connection.prepareStatement("SELECT COUNT(*) FROM idempotency_keys");
        ResultSet rs = ps.executeQuery()) {
      rs.next();
      return rs.getLong(1);
    }
  }
}
