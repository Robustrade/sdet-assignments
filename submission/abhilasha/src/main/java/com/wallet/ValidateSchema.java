package com.wallet;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Validates that the PostgreSQL schema matches the expected structure.
 * Run via: mvn exec:java -Dexec.mainClass="com.wallet.ValidateSchema"
 */
public class ValidateSchema {

    private static final String DB_URL = System.getenv().getOrDefault(
            "DATABASE_URL",
            "jdbc:postgresql://localhost:5432/wallet_schema_check?user=wallet_user&password=wallet_pass");

    private static final Set<String> REQUIRED_TABLES = new HashSet<>(Arrays.asList(
            "wallets", "transfers", "idempotency_keys",
            "transfer_events", "outbox_events", "balance_snapshots"));

    public static void main(String[] args) throws Exception {
        System.out.println("Connecting to: " + DB_URL);

        try (Connection conn = DriverManager.getConnection(DB_URL);
             Statement stmt = conn.createStatement()) {

            checkRequiredTables(stmt);
            checkNonNegativeConstraint(conn);
            checkIdempotencyKeyNotNull(stmt);

            System.out.println("Schema validation passed.");
        }
    }

    private static void checkRequiredTables(Statement stmt) throws Exception {
        try (ResultSet rs = stmt.executeQuery(
                "SELECT table_name FROM information_schema.tables " +
                "WHERE table_schema = 'public'")) {

            Set<String> found = new HashSet<>();
            while (rs.next()) found.add(rs.getString("table_name"));

            Set<String> missing = new HashSet<>(REQUIRED_TABLES);
            missing.removeAll(found);

            if (!missing.isEmpty()) {
                throw new AssertionError("Missing required tables: " + missing);
            }
            System.out.println("PASS: All required tables present: " + REQUIRED_TABLES);
        }
    }

    private static void checkNonNegativeConstraint(Connection conn) throws Exception {
        conn.setAutoCommit(false);
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(
                    "INSERT INTO wallets (id, owner_id, currency, balance) " +
                    "VALUES ('00000000-0000-0000-0000-000000000001', " +
                    "'00000000-0000-0000-0000-000000000002', 'USD', -1.00)");
            conn.rollback();
            throw new AssertionError(
                    "FAIL: Negative balance constraint missing — INSERT should have been rejected");
        } catch (java.sql.SQLException e) {
            conn.rollback();
            System.out.println("PASS: Negative balance correctly rejected by DB constraint");
        } finally {
            conn.setAutoCommit(true);
        }
    }

    private static void checkIdempotencyKeyNotNull(Statement stmt) throws Exception {
        try (ResultSet rs = stmt.executeQuery(
                "SELECT is_nullable FROM information_schema.columns " +
                "WHERE table_name = 'transfers' AND column_name = 'idempotency_key'")) {

            if (!rs.next()) {
                throw new AssertionError("FAIL: Column transfers.idempotency_key not found");
            }
            String nullable = rs.getString("is_nullable");
            if (!"NO".equals(nullable)) {
                throw new AssertionError(
                        "FAIL: transfers.idempotency_key must be NOT NULL but is nullable");
            }
            System.out.println("PASS: transfers.idempotency_key is NOT NULL");
        }
    }
}
