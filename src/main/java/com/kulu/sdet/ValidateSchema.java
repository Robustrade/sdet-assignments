package com.kulu.sdet;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.*;
import java.util.stream.Collectors;

public class ValidateSchema {

    public static final List<String> REQUIRED_TABLES = List.of("wallets", "transactions", "idempotency_keys", "audit_events", "outbox_events");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ValidateSchema() {
    }


    public static JsonNode loadSchema(String classpathPath) throws IOException {
        try (InputStream is = ValidateSchema.class.getClassLoader().getResourceAsStream(classpathPath)) {
            if (is == null) {
                throw new IllegalArgumentException("Schema file not found on classpath: " + classpathPath);
            }
            return MAPPER.readTree(is);
        }
    }


    public static Map<String, String> extractColumnTypes(ResultSetMetaData meta) throws Exception {
        Map<String, String> columns = new LinkedHashMap<>();
        for (int i = 1; i <= meta.getColumnCount(); i++) {
            columns.put(meta.getColumnName(i).toLowerCase(), meta.getColumnTypeName(i).toLowerCase());
        }
        return columns;
    }


    public static void assertRequiredTablesExist(Connection connection) throws Exception {
        assertTablesExist(connection, REQUIRED_TABLES);
    }


    public static void assertTablesExist(Connection connection, List<String> expectedTables) throws Exception {
        Set<String> presentTables = fetchTableNames(connection);

        List<String> missing = expectedTables.stream().filter(t -> !presentTables.contains(t.toLowerCase())).sorted().collect(Collectors.toList());

        if (!missing.isEmpty()) {
            String schema = connection.getSchema();
            StringBuilder msg = new StringBuilder();
            msg.append("\nMissing required tables").append(schema != null ? " in schema '" + schema + "'" : "").append(":\n");

            missing.forEach(t -> msg.append("  - ").append(t).append("  (expected but not found)\n"));

            msg.append("\nAll required tables : ").append(expectedTables).append('\n');
            msg.append("Tables found in DB  : ").append(new TreeSet<>(presentTables)).append('\n');
            msg.append("Hint: check Flyway migrations or run DatabaseSeeder.applySchema()");

            throw new AssertionError(msg.toString());
        }
    }


    public static void assertColumnsExist(Connection connection, String tableName, String... expectedColumns) throws Exception {
        Set<String> presentColumns = fetchColumnNames(connection, tableName);

        List<String> missing = Arrays.stream(expectedColumns).filter(c -> !presentColumns.contains(c.toLowerCase())).sorted().collect(Collectors.toList());

        if (!missing.isEmpty()) {
            throw new AssertionError("\nMissing columns in table '" + tableName + "':\n" + missing.stream().map(c -> "  - " + c + "  (expected but not found)").collect(Collectors.joining("\n")) + "\n\nColumns found in '" + tableName + "': " + new TreeSet<>(presentColumns));
        }
    }


    public static void assertColumnTypes(Connection connection, String tableName, Map<String, String> expectedColumnTypes) throws Exception {

        Map<String, String> actualTypes = fetchColumnTypes(connection, tableName);
        List<String> mismatches = new ArrayList<>();

        for (Map.Entry<String, String> expected : expectedColumnTypes.entrySet()) {
            String col = expected.getKey().toLowerCase();
            String expectedType = expected.getValue().toLowerCase();
            String actualType = actualTypes.get(col);

            if (actualType == null) {
                mismatches.add(String.format("  - %-25s expected type='%s'  actual=COLUMN NOT FOUND", col, expectedType));
            } else if (!actualType.contains(expectedType) && !expectedType.contains(actualType)) {
                mismatches.add(String.format("  - %-25s expected type='%s'  actual='%s'", col, expectedType, actualType));
            }
        }

        if (!mismatches.isEmpty()) {
            throw new AssertionError("\nColumn type mismatches in table '" + tableName + "':\n" + String.join("\n", mismatches) + "\n\nFull column map: " + actualTypes);
        }
    }


    private static Set<String> fetchTableNames(Connection connection) throws Exception {
        Set<String> names = new TreeSet<>();
        DatabaseMetaData meta = connection.getMetaData();
        try (ResultSet rs = meta.getTables(connection.getCatalog(), connection.getSchema(), "%", new String[]{"TABLE", "PARTITIONED TABLE"})) {
            while (rs.next()) {
                names.add(rs.getString("TABLE_NAME").toLowerCase());
            }
        }
        return names;
    }


    private static Set<String> fetchColumnNames(Connection connection, String tableName) throws Exception {
        return fetchColumnTypes(connection, tableName).keySet();
    }


    private static Map<String, String> fetchColumnTypes(Connection connection, String tableName) throws Exception {
        Map<String, String> types = new LinkedHashMap<>();
        DatabaseMetaData meta = connection.getMetaData();
        try (ResultSet rs = meta.getColumns(connection.getCatalog(), connection.getSchema(), tableName.toLowerCase(), "%")) {
            while (rs.next()) {
                types.put(rs.getString("COLUMN_NAME").toLowerCase(), rs.getString("TYPE_NAME").toLowerCase());
            }
        }

        if (types.isEmpty()) {
            try (ResultSet rs = meta.getColumns(null, null, tableName.toLowerCase(), "%")) {
                while (rs.next()) {
                    types.put(rs.getString("COLUMN_NAME").toLowerCase(), rs.getString("TYPE_NAME").toLowerCase());
                }
            }
        }
        return types;
    }
}

