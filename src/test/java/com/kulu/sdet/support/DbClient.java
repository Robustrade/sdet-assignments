package com.kulu.sdet.support;

import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class DbClient implements AutoCloseable {

    private final Connection connection;


    public DbClient(PostgreSQLContainer<?> container) throws SQLException {
        this.connection = DriverManager.getConnection(container.getJdbcUrl(), container.getUsername(), container.getPassword());
        this.connection.setAutoCommit(false);
    }


    public DbClient(String jdbcUrl, String username, String password) throws SQLException {
        this.connection = DriverManager.getConnection(jdbcUrl, username, password);
        this.connection.setAutoCommit(false);
    }


    public List<Map<String, Object>> query(String sql, Object... params) throws SQLException {
        List<Map<String, Object>> rows = new ArrayList<>();
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                ps.setObject(i + 1, params[i]);
            }
            try (ResultSet rs = ps.executeQuery()) {
                ResultSetMetaData meta = rs.getMetaData();
                while (rs.next()) {
                    Map<String, Object> row = new HashMap<>();
                    for (int i = 1; i <= meta.getColumnCount(); i++) {
                        row.put(meta.getColumnName(i).toLowerCase(), rs.getObject(i));
                    }
                    rows.add(row);
                }
            }
        }
        return rows;
    }


    @SuppressWarnings("unchecked")
    public <T> T queryScalar(String sql, Object... params) throws SQLException {
        List<Map<String, Object>> rows = query(sql, params);
        if (rows.isEmpty()) return null;
        return (T) rows.get(0).values().iterator().next();
    }


    public int execute(String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                ps.setObject(i + 1, params[i]);
            }
            return ps.executeUpdate();
        }
    }

    public void commit() throws SQLException {
        connection.commit();
    }

    public void rollback() throws SQLException {
        connection.rollback();
    }

    @Override
    public void close() throws SQLException {
        if (!connection.isClosed()) {
            connection.rollback();
            connection.close();
        }
    }
}
