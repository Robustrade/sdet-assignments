import com.kulu.wallet.db.Database;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;

/**
 * CI entrypoint for db-migration-or-schema-check.
 *
 * <p>Applies schema.sql and verifies required tables exist.
 */
public final class ValidateSchema {
  private static final Set<String> REQUIRED_TABLES =
      Set.of("wallets", "transfers", "idempotency_keys", "transfer_events", "outbox_events");

  public static void main(String[] args) throws Exception {
    Database database = Database.inMemory();
    database.migrate();

    Set<String> found = new TreeSet<>();
    try (Connection connection = database.getConnection()) {
      DatabaseMetaData metaData = connection.getMetaData();
      try (ResultSet tables = metaData.getTables(null, null, "%", new String[] {"TABLE"})) {
        while (tables.next()) {
          found.add(tables.getString("TABLE_NAME").toLowerCase(Locale.ROOT));
        }
      }
    }

    Set<String> missing = new TreeSet<>(REQUIRED_TABLES);
    missing.removeAll(found);
    if (!missing.isEmpty()) {
      System.err.println("Schema validation failed. Missing tables: " + missing);
      System.err.println("Found tables: " + found);
      System.exit(1);
    }

    System.out.println("Schema validation passed. Required tables present: " + REQUIRED_TABLES);
  }

  private ValidateSchema() {}
}
