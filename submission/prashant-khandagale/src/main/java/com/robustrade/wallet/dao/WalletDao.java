package com.robustrade.wallet.dao;

import com.robustrade.wallet.model.Wallet;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;

public class WalletDao {

    /** Plain read, no lock. Used for the GET /wallets/{id} endpoint. */
    public Optional<Wallet> findById(Connection conn, String id) throws SQLException {
        String sql = "SELECT id, currency, balance FROM wallets WHERE id = ?";
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

    /**
     * Locks the wallet row for the remainder of the current transaction using
     * "SELECT ... FOR UPDATE". Any other transaction trying to lock (or update)
     * the same row will block until this transaction commits or rolls back.
     *
     * This is the mechanism that makes concurrent transfers against the same
     * wallet safe: whichever transfer locks the row first reads the true
     * balance, the second one waits, then reads the balance AFTER the first
     * transfer's effect is committed.
     */
    public Optional<Wallet> lockForUpdate(Connection conn, String id) throws SQLException {
        String sql = "SELECT id, currency, balance FROM wallets WHERE id = ? FOR UPDATE";
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

    public void updateBalance(Connection conn, String id, BigDecimal newBalance) throws SQLException {
        String sql = "UPDATE wallets SET balance = ? WHERE id = ?";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setBigDecimal(1, newBalance);
            ps.setString(2, id);
            ps.executeUpdate();
        }
    }

    /** Used by test data builders to seed wallets before a scenario runs. */
    public void insert(Connection conn, Wallet wallet) throws SQLException {
        String sql = "INSERT INTO wallets (id, currency, balance) VALUES (?, ?, ?)";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, wallet.getId());
            ps.setString(2, wallet.getCurrency());
            ps.setBigDecimal(3, wallet.getBalance());
            ps.executeUpdate();
        }
    }

    private Wallet map(ResultSet rs) throws SQLException {
        return new Wallet(rs.getString("id"), rs.getString("currency"), rs.getBigDecimal("balance"));
    }
}
