package com.kulu.sdet.db;

import com.kulu.sdet.config.ConfigReader;

import java.sql.*;

public class WalletDB {

    private static final String URL = ConfigReader.get("db.url");
    private static final String USER = ConfigReader.get("db.username");
    private static final String PASSWORD = ConfigReader.get("db.password");

    private Connection connect() throws Exception {
        return DriverManager.getConnection(URL, USER, PASSWORD);
    }

    public long getBalance(String walletId) {
        String sql = "SELECT balance FROM wallets WHERE id = ?";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, walletId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw new IllegalStateException("wallet not found in DB: " + walletId);
                return rs.getLong("balance");
            }
        } catch (Exception e) {
            throw new RuntimeException("DB query failed", e);
        }
    }

    public int countTransfersByIdempotencyKey(String idempotencyKey) {
        String sql = "SELECT COUNT(*) FROM transfers WHERE idempotency_key = ?";
        try (Connection conn = connect();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, idempotencyKey);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        } catch (Exception e) {
            throw new RuntimeException("DB query failed", e);
        }
    }

}
