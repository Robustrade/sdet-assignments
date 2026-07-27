package com.kulu.sdet;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Standalone schema validator.
 *
 * <p>Rather than spinning up a database, this tool parses the Flyway migration SQL and verifies
 * that every table and column the test suite depends on is declared. This keeps the CI schema check
 * hermetic — no Docker, no JDBC — while still failing loudly if the schema drifts away from what
 * the tests assume.
 */
public final class ValidateSchema {

  private ValidateSchema() {}

  private static final Map<String, Set<String>> REQUIRED = new LinkedHashMap<>();

  static {
    REQUIRED.put("wallets", new LinkedHashSet<>(Set.of("id", "balance", "currency")));
    REQUIRED.put(
        "transfers",
        new LinkedHashSet<>(
            Set.of(
                "id",
                "source_wallet_id",
                "destination_wallet_id",
                "amount",
                "currency",
                "reference",
                "status",
                "idempotency_key",
                "created_at")));
    REQUIRED.put(
        "idempotency_keys",
        new LinkedHashSet<>(
            Set.of(
                "idempotency_key",
                "payload_hash",
                "transfer_id",
                "response_status",
                "response_body",
                "created_at")));
    REQUIRED.put(
        "transfer_events",
        new LinkedHashSet<>(Set.of("id", "transfer_id", "event_type", "payload", "created_at")));
    REQUIRED.put(
        "outbox_events",
        new LinkedHashSet<>(
            Set.of("id", "aggregate_id", "event_type", "payload", "published_at", "created_at")));
  }

  public static void main(String[] args) throws IOException {
    Path migrationsDir = Paths.get("src", "main", "resources", "db", "migration");
    if (!Files.isDirectory(migrationsDir)) {
      fail("Migrations directory not found: " + migrationsDir.toAbsolutePath());
    }

    StringBuilder combined = new StringBuilder();
    try (var stream = Files.list(migrationsDir)) {
      stream
          .filter(p -> p.getFileName().toString().endsWith(".sql"))
          .sorted()
          .forEach(
              p -> {
                try {
                  combined.append(Files.readString(p, StandardCharsets.UTF_8)).append('\n');
                } catch (IOException e) {
                  throw new RuntimeException(e);
                }
              });
    }
    String sql = combined.toString().toLowerCase();

    boolean ok = true;
    for (Map.Entry<String, Set<String>> e : REQUIRED.entrySet()) {
      String table = e.getKey();
      String tableBody = extractCreateTable(sql, table);
      if (tableBody == null) {
        System.err.println("MISSING TABLE: " + table);
        ok = false;
        continue;
      }
      for (String col : e.getValue()) {
        Pattern colPattern = Pattern.compile("(^|[,\\s(])" + Pattern.quote(col) + "\\s");
        if (!colPattern.matcher(tableBody).find()) {
          System.err.println("MISSING COLUMN: " + table + "." + col);
          ok = false;
        }
      }
    }

    // Guardrails for correctness the SUT relies on.
    if (!sql.contains("balance >= 0")) {
      System.err.println("MISSING CONSTRAINT: wallets.balance >= 0");
      ok = false;
    }
    if (!sql.contains("amount > 0")) {
      System.err.println("MISSING CONSTRAINT: transfers.amount > 0");
      ok = false;
    }
    if (!sql.contains("unique index ux_outbox_transfer_completed")) {
      System.err.println("MISSING UNIQUE INDEX: outbox_events(aggregate_id, event_type)");
      ok = false;
    }

    if (!ok) {
      fail("Schema validation failed. See errors above.");
    }
    System.out.println("Schema validation passed. Tables checked: " + REQUIRED.keySet());
  }

  private static String extractCreateTable(String sql, String table) {
    Pattern p =
        Pattern.compile(
            "create\\s+table\\s+" + Pattern.quote(table) + "\\s*\\((.*?)\\)\\s*;", Pattern.DOTALL);
    var m = p.matcher(sql);
    return m.find() ? m.group(1) : null;
  }

  private static void fail(String msg) {
    System.err.println(msg);
    System.exit(1);
  }
}
