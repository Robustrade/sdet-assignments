package com.kulu.db;

import com.kulu.utils.Config;
import java.sql.*;

public class DatabaseManager {
    private final String dbUrl = Config.get("db.url");
    private final String user = Config.get("db.user");
    private final String pass = Config.get("db.pass");

    public Connection getConnection() throws SQLException { return DriverManager.getConnection(dbUrl, user, pass); }

    public void initDatabase() {
        try (Connection conn = getConnection(); Statement stmt = conn.createStatement()) {
            stmt.execute("CREATE TABLE IF NOT EXISTS wallets (id VARCHAR(36) PRIMARY KEY, balance DECIMAL(15,2) NOT NULL)");
            stmt.execute("CREATE TABLE IF NOT EXISTS transfers (id VARCHAR(36) PRIMARY KEY, amount DECIMAL(15,2))");
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public void insertWallet(String id, double balance) {
        String query = "INSERT INTO wallets (id, balance) VALUES (?, ?)";
        try (Connection conn = getConnection(); PreparedStatement pstmt = conn.prepareStatement(query)) {
            pstmt.setString(1, id); pstmt.setDouble(2, balance); pstmt.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public double getBalance(String walletId) {
        String query = "SELECT balance FROM wallets WHERE id = ?";
        try (Connection conn = getConnection(); PreparedStatement pstmt = conn.prepareStatement(query)) {
            pstmt.setString(1, walletId); ResultSet rs = pstmt.executeQuery();
            return rs.next() ? rs.getDouble("balance") : 0.0;
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public void clearDatabase() {
        try (Connection conn = getConnection(); Statement stmt = conn.createStatement()) {
            stmt.execute("DELETE FROM transfers"); stmt.execute("DELETE FROM wallets");
        } catch (SQLException e) { throw new RuntimeException(e); }
    }
}