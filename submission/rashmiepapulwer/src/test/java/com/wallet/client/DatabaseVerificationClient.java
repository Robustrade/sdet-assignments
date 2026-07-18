package com.wallet.client;

import com.wallet.model.TransferRecord;
import com.wallet.model.WalletBalance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigDecimal;
import java.sql.*;
import java.util.*;

/**
 * Direct JDBC access to the PostgreSQL test database for post-execution verification.
 *
 * This class exists purely for assertions — it never modifies application state
 * except for test fixture setup (wallet seeding) and cleanup.
 *
 * Connection-per-operation: tests are not perf-critical; simple and leak-free.
 */
public class DatabaseVerificationClient {

    private static final Logger log = LoggerFactory.getLogger(DatabaseVerificationClient.class);

    private final String jdbcUrl;
    private final String username;
    private final String password;

    public DatabaseVerificationClient(String jdbcUrl, String username, String password) {
        this.jdbcUrl = jdbcUrl;
        this.username = username;
        this.password = password;
    }

    // ─── Wallet queries ───────────────────────────────────────────────────────

    public WalletBalance getWalletBalance(String walletId) {
        String sql = "SELECT id, balance, currency, version FROM wallets WHERE id = ?::uuid";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, walletId);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                return new WalletBalance(
                        rs.getString("id"),
                        rs.getBigDecimal("balance"),
                        rs.getString("currency"),
                        rs.getLong("version")
                );
            }
            throw new IllegalArgumentException("Wallet not found: " + walletId);
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: getWalletBalance(" + walletId + ")", e);
        }
    }

    public String createWallet(String ownerId, String currency, BigDecimal initialBalance) {
        String sql = """
                INSERT INTO wallets (owner_id, currency, balance)
                VALUES (?, ?, ?)
                RETURNING id::text
                """;
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, ownerId);
            ps.setString(2, currency);
            ps.setBigDecimal(3, initialBalance);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                String id = rs.getString(1);
                log.debug("Created wallet id={} owner={} balance={} {}", id, ownerId, initialBalance, currency);
                return id;
            }
            throw new RuntimeException("Wallet INSERT returned no row");
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: createWallet", e);
        }
    }

    public void setWalletBalance(String walletId, BigDecimal newBalance) {
        String sql = "UPDATE wallets SET balance = ?, updated_at = NOW() WHERE id = ?::uuid";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setBigDecimal(1, newBalance);
            ps.setString(2, walletId);
            int rows = ps.executeUpdate();
            if (rows != 1) throw new RuntimeException("setWalletBalance affected " + rows + " rows for id=" + walletId);
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: setWalletBalance", e);
        }
    }

    // ─── Transfer queries ─────────────────────────────────────────────────────

    public Optional<TransferRecord> findTransferById(String transferId) {
        String sql = """
                SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
                       status, reference, idempotency_key, failure_reason
                FROM transfers
                WHERE id = ?::uuid
                """;
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                return Optional.of(mapTransferRecord(rs));
            }
            return Optional.empty();
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: findTransferById(" + transferId + ")", e);
        }
    }

    public Optional<TransferRecord> findTransferByIdempotencyKey(String idempotencyKey) {
        String sql = """
                SELECT t.id, t.source_wallet_id, t.destination_wallet_id, t.amount, t.currency,
                       t.status, t.reference, t.idempotency_key, t.failure_reason
                FROM transfers t
                WHERE t.idempotency_key = ?
                """;
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, idempotencyKey);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                return Optional.of(mapTransferRecord(rs));
            }
            return Optional.empty();
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: findTransferByIdempotencyKey", e);
        }
    }

    public List<TransferRecord> findTransfersBySourceWallet(String sourceWalletId) {
        String sql = """
                SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
                       status, reference, idempotency_key, failure_reason
                FROM transfers
                WHERE source_wallet_id = ?::uuid
                ORDER BY created_at DESC
                """;
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, sourceWalletId);
            ResultSet rs = ps.executeQuery();
            List<TransferRecord> records = new ArrayList<>();
            while (rs.next()) records.add(mapTransferRecord(rs));
            return records;
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: findTransfersBySourceWallet", e);
        }
    }

    public int countTransfersByIdempotencyKey(String idempotencyKey) {
        String sql = "SELECT COUNT(*) FROM transfers WHERE idempotency_key = ?";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, idempotencyKey);
            ResultSet rs = ps.executeQuery();
            rs.next();
            return rs.getInt(1);
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: countTransfersByIdempotencyKey", e);
        }
    }

    // ─── Idempotency key queries ──────────────────────────────────────────────

    public boolean idempotencyKeyExists(String key) {
        String sql = "SELECT 1 FROM idempotency_keys WHERE key = ?";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, key);
            ResultSet rs = ps.executeQuery();
            return rs.next();
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: idempotencyKeyExists", e);
        }
    }

    // ─── Audit / event queries ────────────────────────────────────────────────

    public List<String> getTransferEventTypes(String transferId) {
        String sql = """
                SELECT event_type FROM transfer_events
                WHERE transfer_id = ?::uuid
                ORDER BY created_at ASC
                """;
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            ResultSet rs = ps.executeQuery();
            List<String> types = new ArrayList<>();
            while (rs.next()) types.add(rs.getString("event_type"));
            return types;
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: getTransferEventTypes", e);
        }
    }

    public int countTransferEvents(String transferId) {
        String sql = "SELECT COUNT(*) FROM transfer_events WHERE transfer_id = ?::uuid";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            ResultSet rs = ps.executeQuery();
            rs.next();
            return rs.getInt(1);
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: countTransferEvents", e);
        }
    }

    public List<Map<String, Object>> getBalanceSnapshots(String transferId) {
        String sql = """
                SELECT wallet_id, balance_before, balance_after, delta
                FROM balance_snapshots
                WHERE transfer_id = ?::uuid
                ORDER BY snapshot_at ASC
                """;
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            ResultSet rs = ps.executeQuery();
            List<Map<String, Object>> snapshots = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("wallet_id",      rs.getString("wallet_id"));
                row.put("balance_before", rs.getBigDecimal("balance_before"));
                row.put("balance_after",  rs.getBigDecimal("balance_after"));
                row.put("delta",          rs.getBigDecimal("delta"));
                snapshots.add(row);
            }
            return snapshots;
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: getBalanceSnapshots", e);
        }
    }

    public int countOutboxEventsByAggregateId(String aggregateId) {
        String sql = "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ?::uuid";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, aggregateId);
            ResultSet rs = ps.executeQuery();
            rs.next();
            return rs.getInt(1);
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: countOutboxEventsByAggregateId", e);
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────

    public void deleteWalletData(List<String> walletIds) {
        if (walletIds.isEmpty()) return;

        String placeholders = String.join(",", Collections.nCopies(walletIds.size(), "?::uuid"));

        // All child-table deletes go via a subquery on the transfers table,
        // which is itself scoped to the test's wallet IDs. FK order: children first.
        String transferSubquery =
                "(SELECT id FROM transfers WHERE source_wallet_id IN (" + placeholders + ") " +
                        "OR destination_wallet_id IN (" + placeholders + "))";

        try (Connection conn = connect()) {

            // 1. balance_snapshots — FK on transfer_id
            deleteViaTransferSubquery(conn, "balance_snapshots", "transfer_id",
                    transferSubquery, walletIds);

            // 2. transfer_events — FK on transfer_id
            deleteViaTransferSubquery(conn, "transfer_events", "transfer_id",
                    transferSubquery, walletIds);

            // 3. outbox_events — aggregate_id == transfer_id
            deleteViaTransferSubquery(conn, "outbox_events", "aggregate_id",
                    transferSubquery, walletIds);

            // 4. idempotency_keys — FK on transfer_id
            deleteViaTransferSubquery(conn, "idempotency_keys", "transfer_id",
                    transferSubquery, walletIds);

            // 5. transfers — direct FK on wallet columns
            String deleteTransfers = "DELETE FROM transfers WHERE source_wallet_id IN (" + placeholders + ") " +
                    "OR destination_wallet_id IN (" + placeholders + ")";
            try (PreparedStatement ps = conn.prepareStatement(deleteTransfers)) {
                for (int i = 0; i < walletIds.size(); i++) {
                    ps.setString(i + 1, walletIds.get(i));
                    ps.setString(i + 1 + walletIds.size(), walletIds.get(i));
                }
                ps.executeUpdate();
            }

            // 6. wallets — root table
            String deleteWallets = "DELETE FROM wallets WHERE id IN (" + placeholders + ")";
            try (PreparedStatement ps = conn.prepareStatement(deleteWallets)) {
                for (int i = 0; i < walletIds.size(); i++) {
                    ps.setString(i + 1, walletIds.get(i));
                }
                ps.executeUpdate();
            }

        } catch (SQLException e) {
            throw new RuntimeException("DB cleanup failed for wallets: " + walletIds, e);
        }
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    private void deleteViaTransferSubquery(Connection conn, String table, String fkColumn,
                                           String transferSubquery, List<String> walletIds)
            throws SQLException {
        String sql = "DELETE FROM " + table + " WHERE " + fkColumn + " IN " + transferSubquery;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            for (int i = 0; i < walletIds.size(); i++) {
                ps.setString(i + 1, walletIds.get(i));
                ps.setString(i + 1 + walletIds.size(), walletIds.get(i));
            }
            ps.executeUpdate();
        }
    }

    private Connection connect() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    private TransferRecord mapTransferRecord(ResultSet rs) throws SQLException {
        return new TransferRecord(
                rs.getString("id"),
                rs.getString("source_wallet_id"),
                rs.getString("destination_wallet_id"),
                rs.getBigDecimal("amount"),
                rs.getString("currency"),
                rs.getString("status"),
                rs.getString("reference"),
                rs.getString("idempotency_key"),
                rs.getString("failure_reason")
        );
    }
}