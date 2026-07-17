package com.robustrade.wallet.db;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Very small JDBC helper. No connection pool -- each caller opens a
 * connection, does its work, and closes it (try-with-resources). H2 is fast
 * enough locally that this is not a bottleneck, and it keeps the code easy
 * to read: every method that touches the DB is explicit about its
 * connection and transaction boundaries.
 */
public final class Database {

    private final String jdbcUrl;

    public Database(String jdbcUrl) {
        this.jdbcUrl = jdbcUrl;
        try {
            Class.forName("org.h2.Driver");
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("H2 driver not on classpath", e);
        }
    }

    public Connection getConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, "sa", "");
    }

    /** Creates all tables if they don't already exist. Safe to call every startup. */
    public void initSchema() {
        String ddl = """
            CREATE TABLE IF NOT EXISTS wallets (
                id VARCHAR(64) PRIMARY KEY,
                currency VARCHAR(3) NOT NULL,
                balance DECIMAL(19,4) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transfers (
                id VARCHAR(64) PRIMARY KEY,
                source_wallet_id VARCHAR(64) NOT NULL,
                destination_wallet_id VARCHAR(64) NOT NULL,
                amount DECIMAL(19,4) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                reference VARCHAR(255),
                status VARCHAR(20) NOT NULL,
                rejection_reason VARCHAR(255),
                created_at TIMESTAMP NOT NULL
            );

            CREATE TABLE IF NOT EXISTS idempotency_keys (
                idempotency_key VARCHAR(128) PRIMARY KEY,
                request_hash VARCHAR(64) NOT NULL,
                response_status INT,
                response_body VARCHAR(4000),
                transfer_id VARCHAR(64),
                created_at TIMESTAMP NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transfer_events (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                transfer_id VARCHAR(64) NOT NULL,
                event_type VARCHAR(64) NOT NULL,
                details VARCHAR(1000),
                created_at TIMESTAMP NOT NULL
            );

            CREATE TABLE IF NOT EXISTS outbox_events (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                transfer_id VARCHAR(64) NOT NULL,
                event_type VARCHAR(64) NOT NULL,
                payload VARCHAR(2000),
                status VARCHAR(20) NOT NULL,
                created_at TIMESTAMP NOT NULL
            );
            """;

        try (Connection conn = getConnection(); Statement st = conn.createStatement()) {
            for (String statement : ddl.split(";")) {
                if (!statement.isBlank()) {
                    st.execute(statement);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to initialize schema", e);
        }
    }

    /** Wipes all data (but keeps schema) -- used between test classes to avoid stale-data false positives. */
    public void resetAllData() {
        try (Connection conn = getConnection(); Statement st = conn.createStatement()) {
            st.execute("DELETE FROM outbox_events");
            st.execute("DELETE FROM transfer_events");
            st.execute("DELETE FROM idempotency_keys");
            st.execute("DELETE FROM transfers");
            st.execute("DELETE FROM wallets");
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to reset data", e);
        }
    }
}
