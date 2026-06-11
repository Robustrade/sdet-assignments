package com.kulu.sdet.db;

import com.kulu.sdet.ValidateSchema;
import com.kulu.sdet.support.DatabaseSeeder;
import com.kulu.sdet.support.DbClient;
import com.kulu.sdet.support.TestConfig;
import org.junit.jupiter.api.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Tag("schema")
@Testcontainers
@DisplayName("Database Schema Validation")
class WalletSchemaValidationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(TestConfig.DB_IMAGE).withDatabaseName(TestConfig.DB_NAME).withUsername(TestConfig.DB_USER).withPassword(TestConfig.DB_PASS);

    private Connection connection;
    private DbClient db;

    @BeforeEach
    void setUp() throws Exception {
        db = new DbClient(POSTGRES);
        connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        DatabaseSeeder.applySchema(db);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (connection != null && !connection.isClosed()) connection.close();
        db.close();
    }


    @Test
    @DisplayName("All required service tables are present in the database")
    void allRequiredTablesExist() throws Exception {

        ValidateSchema.assertRequiredTablesExist(connection);
    }

    @Test
    @DisplayName("Missing table produces a descriptive error listing the absent tables")
    void missingTable_descriptiveError() {
        List<String> withFakeTable = List.of("wallets", "non_existent_table_xyz");

        AssertionError err = assertThrows(AssertionError.class, () -> ValidateSchema.assertTablesExist(connection, withFakeTable));

        String message = err.getMessage();
        assertTrue(message.contains("non_existent_table_xyz"), "Error must name the missing table. actual:\n" + message);
        assertTrue(message.contains("expected but not found"), "Error must say 'expected but not found'. actual:\n" + message);
        assertTrue(message.contains("All required tables"), "Error must list all required tables. actual:\n" + message);
        assertTrue(message.contains("Tables found in DB"), "Error must list tables actually present. actual:\n" + message);
        assertTrue(message.contains("Hint:"), "Error must include a remediation hint. actual:\n" + message);
    }


    @Test
    @DisplayName("wallets table has all required columns")
    void walletsTable_hasRequiredColumns() throws Exception {
        ValidateSchema.assertColumnsExist(connection, "wallets", "id", "owner_id", "balance", "currency");
    }

    @Test
    @DisplayName("wallets table has correct column types")
    void walletsTable_hasCorrectColumnTypes() throws Exception {
        ValidateSchema.assertColumnTypes(connection, "wallets", Map.of("balance", "numeric", "currency", "varchar", "id", "varchar", "owner_id", "varchar"));
    }


    @Test
    @DisplayName("transactions table has all required columns")
    void transactionsTable_hasRequiredColumns() throws Exception {
        ValidateSchema.assertColumnsExist(connection, "transactions", "id", "from_wallet_id", "to_wallet_id", "amount", "currency", "status", "created_at");
    }

    @Test
    @DisplayName("transactions table has correct column types")
    void transactionsTable_hasCorrectColumnTypes() throws Exception {
        ValidateSchema.assertColumnTypes(connection, "transactions", Map.of("amount", "numeric", "currency", "varchar", "status", "varchar", "created_at", "timestamptz"));
    }


    @Test
    @DisplayName("outbox_events table has all required columns")
    void outboxEventsTable_hasRequiredColumns() throws Exception {
        ValidateSchema.assertColumnsExist(connection, "outbox_events", "id", "event_type", "aggregate_id", "payload", "published_at", "created_at");
    }


    @Test
    @DisplayName("audit_events table has all required columns")
    void auditEventsTable_hasRequiredColumns() throws Exception {
        ValidateSchema.assertColumnsExist(connection, "audit_events", "id", "event_type", "resource_type", "resource_id", "occurred_at");
    }


    @Test
    @DisplayName("Column type mismatch produces a descriptive error naming the column and types")
    void columnTypeMismatch_descriptiveError() {
        AssertionError err = assertThrows(AssertionError.class, () -> ValidateSchema.assertColumnTypes(connection, "wallets", Map.of("balance", "text")));

        String message = err.getMessage();
        assertTrue(message.contains("balance"), "Error must name the mismatched column. actual:\n" + message);
        assertTrue(message.contains("text"), "Error must show the expected type. actual:\n" + message);
        assertTrue(message.contains("numeric"), "Error must show the actual type. actual:\n" + message);
    }
}
