package com.robustrade.wallet.support;

import com.robustrade.wallet.db.Database;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Runs plain SQL directly against the wallet database, completely
 * independent of the service's own DAO code path. This is what proves
 * "the API's answer matches what's actually on disk" instead of just
 * trusting the app's own read endpoints.
 */
public class DbVerifier {

    private final Database database;

    public DbVerifier(Database database) {
        this.database = database;
    }

    public BigDecimal walletBalance(String walletId) {
        return queryBigDecimal("SELECT balance FROM wallets WHERE id = ?", walletId);
    }

    public int transferRowCount(String transferId) {
        return queryInt("SELECT COUNT(*) FROM transfers WHERE id = ?", transferId);
    }

    public int totalTransferCount() {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM transfers")) {
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public String transferStatus(String transferId) {
        return queryString("SELECT status FROM transfers WHERE id = ?", transferId);
    }

    public int idempotencyRowCount(String idempotencyKey) {
        return queryInt("SELECT COUNT(*) FROM idempotency_keys WHERE idempotency_key = ?", idempotencyKey);
    }

    public int transferEventCount(String transferId) {
        return queryInt("SELECT COUNT(*) FROM transfer_events WHERE transfer_id = ?", transferId);
    }

    public int outboxEventCount(String transferId) {
        return queryInt("SELECT COUNT(*) FROM outbox_events WHERE transfer_id = ?", transferId);
    }

    public int outboxEventCountByStatus(String transferId, String status) {
        String sql = "SELECT COUNT(*) FROM outbox_events WHERE transfer_id = ? AND status = ?";
        try (Connection conn = database.getConnection(); PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            ps.setString(2, status);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    /** Total number of transfer rows between an exact (source, destination) pair -- used to catch duplicate processing. */
    public int transferCountForWalletPair(String source, String destination) {
        String sql = "SELECT COUNT(*) FROM transfers WHERE source_wallet_id = ? AND destination_wallet_id = ?";
        try (Connection conn = database.getConnection(); PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, source);
            ps.setString(2, destination);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    private BigDecimal queryBigDecimal(String sql, String param) {
        try (Connection conn = database.getConnection(); PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, param);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getBigDecimal(1) : null;
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    private int queryInt(String sql, String param) {
        try (Connection conn = database.getConnection(); PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, param);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    private String queryString(String sql, String param) {
        try (Connection conn = database.getConnection(); PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, param);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }
}
