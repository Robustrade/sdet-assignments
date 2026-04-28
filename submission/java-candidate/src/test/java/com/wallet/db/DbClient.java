package com.wallet.db;

import com.wallet.config.TestConfig;
import com.wallet.config.TestContainersConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.*;
import java.util.*;

/**
 * Bare-bones JDBC wrapper used by all the repository classes.
 * Picks up credentials from Testcontainers when running locally,
 * or from DB_URL env var when running in CI against a real database.
 */
public class DbClient {

    private static final Logger log = LoggerFactory.getLogger(DbClient.class);

    private final String url;
    private final String user;
    private final String password;

    public DbClient() {
        String envUrl = TestConfig.DB_URL;
        if (envUrl == null || envUrl.isBlank()) {
            // no external DB configured — use the Testcontainers one
            this.url      = TestContainersConfig.getJdbcUrl();
            this.user     = TestContainersConfig.getUser();
            this.password = TestContainersConfig.getPassword();
        } else {
            // CI/staging — use the provided URL
            this.url      = envUrl;
            this.user     = TestConfig.DB_USER;
            this.password = TestConfig.DB_PASSWORD;
        }
        log.debug("DbClient connected to {}", this.url);
    }

    /** Runs a SELECT and hands back all rows as a list of maps. Good enough for test use. */
    public List<Map<String, Object>> query(String sql, Object... params) {
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            setParams(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                return mapResultSet(rs);
            }
        } catch (SQLException e) {
            throw new RuntimeException("DB query failed: " + sql, e);
        }
    }

    /** Like query() but expects exactly one row — throws if it gets zero. */
    public Map<String, Object> queryOne(String sql, Object... params) {
        List<Map<String, Object>> rows = query(sql, params);
        // blow up fast if nothing came back — helps catch test data setup issues early
        if (rows.isEmpty()) throw new NoSuchElementException("No row found for: " + sql);
        return rows.get(0);
    }

    /** For INSERT / UPDATE / DELETE statements. Returns affected row count. */
    public int execute(String sql, Object... params) {
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            setParams(ps, params);
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("DB execute failed: " + sql, e);
        }
    }

    /** Runs multiple statements in a single transaction — rolls back everything on failure. */
    public void executeInTransaction(List<String> statements) {
        try (Connection conn = getConnection()) {
            conn.setAutoCommit(false);
            try (Statement stmt = conn.createStatement()) {
                for (String sql : statements) {
                    stmt.execute(sql);
                }
                conn.commit();
            } catch (SQLException e) {
                // roll back everything on any failure — all or nothing
                conn.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Transaction failed", e);
        }
    }

    // ─────────────────────────────────────────────
    //  Private helpers
    // ─────────────────────────────────────────────

    public Connection getConnection() throws SQLException {
        return DriverManager.getConnection(url, user, password);
    }

    private void setParams(PreparedStatement ps, Object[] params) throws SQLException {
        // bind parameters positionally — simple and works for all types
        for (int i = 0; i < params.length; i++) {
            ps.setObject(i + 1, params[i]);
        }
    }

    private List<Map<String, Object>> mapResultSet(ResultSet rs) throws SQLException {
        ResultSetMetaData meta = rs.getMetaData();
        int cols = meta.getColumnCount();
        List<Map<String, Object>> rows = new ArrayList<>();
        while (rs.next()) {
            // LinkedHashMap preserves column order which is nice for debugging
            Map<String, Object> row = new LinkedHashMap<>();
            for (int i = 1; i <= cols; i++) {
                row.put(meta.getColumnName(i), rs.getObject(i));
            }
            rows.add(row);
        }
        return rows;
    }
}
