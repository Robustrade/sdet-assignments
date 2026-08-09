package com.wallet.db;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public class DatabaseHelper {
    private final Connection connection;

    // Inject the real database connection (e.g., from Testcontainers or HikariCP)
    public DatabaseHelper(Connection connection) {
        this.connection = connection;
    }

    public double getWalletBalance(String walletId) {
        String query = "SELECT balance FROM wallets WHERE id = ?";
        try (PreparedStatement stmt = connection.prepareStatement(query)) {
            stmt.setString(1, walletId);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return rs.getDouble("balance");
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to fetch wallet balance", e);
        }
        throw new IllegalArgumentException("Wallet not found: " + walletId);
    }

    public int getTransferRecordCount(String idempotencyKey) {
        String query = "SELECT COUNT(*) FROM transfers WHERE idempotency_key = ?";
        try (PreparedStatement stmt = connection.prepareStatement(query)) {
            stmt.setString(1, idempotencyKey);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return rs.getInt(1);
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to count transfer records", e);
        }
        return 0;
    }
}