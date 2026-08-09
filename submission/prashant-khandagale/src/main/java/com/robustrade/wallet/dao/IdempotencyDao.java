package com.robustrade.wallet.dao;

import com.robustrade.wallet.model.IdempotencyRecord;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

public class IdempotencyDao {

    public boolean tryClaim(Connection conn, String idempotencyKey, String requestHash) throws SQLException {
        String sql = """
            INSERT INTO idempotency_keys (idempotency_key, request_hash, response_status, response_body, transfer_id, created_at)
            VALUES (?, ?, NULL, NULL, NULL, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, idempotencyKey);
            ps.setString(2, requestHash);
            ps.setTimestamp(3, Timestamp.from(Instant.now()));
            ps.executeUpdate();
            return true;
        } catch (SQLIntegrityConstraintViolationException e) {
            return false;
        }
    }

    public void finalizeRecord(Connection conn, String idempotencyKey, int responseStatus,
                                String responseBody, String transferId) throws SQLException {
        String sql = """
            UPDATE idempotency_keys
            SET response_status = ?, response_body = ?, transfer_id = ?
            WHERE idempotency_key = ?
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, responseStatus);
            ps.setString(2, responseBody);
            ps.setString(3, transferId);
            ps.setString(4, idempotencyKey);
            ps.executeUpdate();
        }
    }

    public Optional<IdempotencyRecord> findByKey(Connection conn, String idempotencyKey) throws SQLException {
        String sql = """
            SELECT idempotency_key, request_hash, response_status, response_body, transfer_id, created_at
            FROM idempotency_keys WHERE idempotency_key = ?
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, idempotencyKey);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(new IdempotencyRecord(
                        rs.getString("idempotency_key"),
                        rs.getString("request_hash"),
                        rs.getInt("response_status"),
                        rs.getString("response_body"),
                        rs.getString("transfer_id"),
                        Instant.ofEpochMilli(rs.getTimestamp("created_at").getTime())
                ));
            }
        }
    }
}
