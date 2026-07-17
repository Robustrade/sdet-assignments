package com.robustrade.wallet.dao;

import com.robustrade.wallet.model.Transfer;
import com.robustrade.wallet.model.TransferStatus;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

public class TransferDao {

    public void insert(Connection conn, Transfer t) throws SQLException {
        String sql = """
            INSERT INTO transfers
                (id, source_wallet_id, destination_wallet_id, amount, currency, reference,
                 status, rejection_reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, t.getId());
            ps.setString(2, t.getSourceWalletId());
            ps.setString(3, t.getDestinationWalletId());
            ps.setBigDecimal(4, t.getAmount());
            ps.setString(5, t.getCurrency());
            ps.setString(6, t.getReference());
            ps.setString(7, t.getStatus().name());
            ps.setString(8, t.getRejectionReason());
            ps.setTimestamp(9, Timestamp.from(t.getCreatedAt()));
            ps.executeUpdate();
        }
    }

    public Optional<Transfer> findById(Connection conn, String id) throws SQLException {
        String sql = """
            SELECT id, source_wallet_id, destination_wallet_id, amount, currency, reference,
                   status, rejection_reason, created_at
            FROM transfers WHERE id = ?
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(map(rs));
            }
        }
    }

    private Transfer map(ResultSet rs) throws SQLException {
        return new Transfer(
                rs.getString("id"),
                rs.getString("source_wallet_id"),
                rs.getString("destination_wallet_id"),
                rs.getBigDecimal("amount"),
                rs.getString("currency"),
                rs.getString("reference"),
                TransferStatus.valueOf(rs.getString("status")),
                rs.getString("rejection_reason"),
                Instant.ofEpochMilli(rs.getTimestamp("created_at").getTime())
        );
    }
}
