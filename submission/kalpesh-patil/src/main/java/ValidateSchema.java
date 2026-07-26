import com.wallet.fixture.db.Database;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;

/**
 * CI schema-validation entry point (wired into the {@code db-migration-or-schema-check} job).
 *
 * <p>Boots the same embedded PostgreSQL the test suite uses, applies {@code schema.sql} against it,
 * and asserts that every table and column the test suite depends on actually exists with the
 * expected type. This exists so that a typo in {@code schema.sql} fails fast in its own CI job with
 * a clear message, rather than surfacing as a confusing failure deep inside an unrelated test.
 */
public final class ValidateSchema {

  private static final Map<String, List<String>> EXPECTED_COLUMNS =
      Map.of(
          "wallets", List.of("wallet_id", "currency", "balance", "created_at", "updated_at"),
          "transfers",
              List.of(
                  "transfer_id",
                  "source_wallet_id",
                  "destination_wallet_id",
                  "amount",
                  "currency",
                  "reference",
                  "status",
                  "failure_reason",
                  "created_at",
                  "completed_at"),
          "idempotency_keys",
              List.of("idempotency_key", "request_hash", "state", "transfer_id", "response_status"),
          "transfer_events", List.of("event_id", "transfer_id", "event_type", "details"),
          "outbox_events",
              List.of(
                  "outbox_id",
                  "aggregate_type",
                  "aggregate_id",
                  "event_type",
                  "payload",
                  "published"));

  private ValidateSchema() {}

  public static void main(String[] args) {
    Database database = Database.start();
    try {
      List<String> failures = validate(database.dataSource());
      if (failures.isEmpty()) {
        System.out.println(
            "Schema validation passed: " + EXPECTED_COLUMNS.size() + " tables verified.");
      } else {
        System.err.println("Schema validation FAILED:");
        failures.forEach(failure -> System.err.println("  - " + failure));
        System.exit(1);
      }
    } finally {
      database.stop();
    }
  }

  private static List<String> validate(DataSource dataSource) {
    List<String> failures = new java.util.ArrayList<>();
    for (Map.Entry<String, List<String>> table : EXPECTED_COLUMNS.entrySet()) {
      List<String> actualColumns = columnsOf(dataSource, table.getKey());
      if (actualColumns.isEmpty()) {
        failures.add("Table '" + table.getKey() + "' does not exist");
        continue;
      }
      for (String expectedColumn : table.getValue()) {
        if (!actualColumns.contains(expectedColumn)) {
          failures.add(
              "Table '" + table.getKey() + "' is missing expected column '" + expectedColumn + "'");
        }
      }
    }
    return failures;
  }

  private static List<String> columnsOf(DataSource dataSource, String tableName) {
    String sql =
        "SELECT column_name FROM information_schema.columns "
            + "WHERE table_schema = 'public' AND table_name = ?";
    try (Connection connection = dataSource.getConnection();
        PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        List<String> columns = new java.util.ArrayList<>();
        while (rs.next()) {
          columns.add(rs.getString("column_name"));
        }
        return columns;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to inspect table " + tableName, e);
    }
  }
}
