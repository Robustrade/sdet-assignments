package com.kulu.sdet;

import com.kulu.sdet.service.SchemaInitializer;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public class ValidateSchema {

  private static final Map<String, Set<String>> REQUIRED =
      Map.of(
          "wallets",
          Set.of("id", "balance", "currency"),
          "transfers",
          Set.of(
              "id",
              "source_wallet_id",
              "destination_wallet_id",
              "amount",
              "currency",
              "status",
              "idempotency_key",
              "created_at"),
          "audit_events",
          Set.of("id", "transfer_id", "event_type", "created_at"),
          "outbox_events",
          Set.of("id", "transfer_id", "event_type", "created_at"));

  public static void main(String[] args) {
    try (Connection conn =
        DriverManager.getConnection("jdbc:h2:mem:schema_check;DB_CLOSE_DELAY=-1", "sa", "")) {
      SchemaInitializer.initSchema(conn);
      conn.commit();

      boolean failed = false;
      for (Map.Entry<String, Set<String>> entry : REQUIRED.entrySet()) {
        String table = entry.getKey();
        Set<String> requiredCols = entry.getValue();
        Set<String> existing = getColumns(conn, table);
        Set<String> missing = new LinkedHashSet<>(requiredCols);
        missing.removeAll(existing);
        if (!missing.isEmpty()) {
          System.err.println("ERROR: Table '" + table + "' missing columns: " + missing);
          failed = true;
        } else {
          System.out.println("OK: " + table);
        }
      }

      if (failed) {
        System.exit(1);
      }
      System.out.println("Schema validation passed.");
    } catch (SQLException e) {
      System.err.println("Schema validation failed: " + e.getMessage());
      System.exit(1);
    }
  }

  private static Set<String> getColumns(Connection conn, String table) throws SQLException {
    Set<String> columns = new LinkedHashSet<>();
    try (Statement stmt = conn.createStatement();
        ResultSet rs =
            stmt.executeQuery(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS"
                    + " WHERE TABLE_NAME = '"
                    + table.toUpperCase()
                    + "'")) {
      while (rs.next()) {
        columns.add(rs.getString("COLUMN_NAME").toLowerCase());
      }
    }
    return columns;
  }
}
