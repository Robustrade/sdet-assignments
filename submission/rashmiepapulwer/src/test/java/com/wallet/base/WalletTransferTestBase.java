package com.wallet.base;

import com.wallet.client.DatabaseVerificationClient;
import com.wallet.client.WalletTransferApiClient;
import com.wallet.fixture.WalletFixture;
import io.restassured.RestAssured;
import io.restassured.config.ObjectMapperConfig;
import io.restassured.config.RestAssuredConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/**
 * Base class for all wallet transfer integration tests.
 *
 * Lifecycle:
 *   @BeforeAll  — start shared PostgreSQL container, run schema migration
 *   @BeforeEach — reset database state, re-seed wallets for isolation
 *   @AfterEach  — collect any leftover test artefacts for debugging
 *
 * The PostgreSQL container is shared across ALL tests in a suite (static).
 * Each test gets fresh wallet rows with unique IDs so tests do not interfere.
 */
@Testcontainers
public abstract class WalletTransferTestBase {

    protected static final Logger log = LoggerFactory.getLogger(WalletTransferTestBase.class);

    // ─── Shared container (started once per JVM, reused across test classes) ──
    @Container
    protected static final PostgreSQLContainer<?> postgres =
            new PostgreSQLContainer<>("postgres:15-alpine")
                    .withDatabaseName("wallet_test")
                    .withUsername("wallet_user")
                    .withPassword("wallet_pass")
                    .withInitScript("db/schema.sql");

    // Base URL of the service under test — override via system property or env
    protected static String baseUrl;

    // Shared clients — initialised once when containers are up
    protected static DatabaseVerificationClient dbClient;
    protected WalletTransferApiClient apiClient;
    protected WalletFixture walletFixture;

    // Track wallet IDs created per test for targeted cleanup
    protected List<String> testWalletIds = new ArrayList<>();

    @BeforeAll
    static void startInfrastructure() {
        // Resolve service base URL
        baseUrl = resolveBaseUrl();
        log.info("Service under test: {}", baseUrl);

        // Wire up DB client against the Testcontainer JDBC URL
        dbClient = new DatabaseVerificationClient(
                postgres.getJdbcUrl(),
                postgres.getUsername(),
                postgres.getPassword()
        );

        // Configure RestAssured globally
        RestAssured.baseURI = baseUrl;
        RestAssured.config = RestAssuredConfig.config()
                .objectMapperConfig(
                        ObjectMapperConfig.objectMapperConfig()
                                .defaultObjectMapperType(io.restassured.mapper.ObjectMapperType.JACKSON_2)
                );
        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails();
    }

    @BeforeEach
    void setupTestContext() {
        apiClient = new WalletTransferApiClient(baseUrl);
        walletFixture = new WalletFixture(dbClient);
        testWalletIds = new ArrayList<>();
        log.debug("Test context initialised. DB URL: {}", postgres.getJdbcUrl());
    }

    @AfterEach
    void cleanupTestContext() {
        if (!testWalletIds.isEmpty()) {
            try {
                dbClient.deleteWalletData(testWalletIds);
                log.debug("Cleaned up {} test wallets", testWalletIds.size());
            } catch (Exception e) {
                log.warn("Cleanup failed for wallets {}: {}", testWalletIds, e.getMessage());
            }
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Resolves the API base URL from environment/system properties, falling back
     * to localhost:8080 for local runs where the service is started separately.
     */
    private static String resolveBaseUrl() {
        String envUrl = System.getenv("WALLET_SERVICE_URL");
        if (envUrl != null && !envUrl.isBlank()) return envUrl;

        String propUrl = System.getProperty("wallet.service.url");
        if (propUrl != null && !propUrl.isBlank()) return propUrl;

        return "http://localhost:8080";
    }

    /**
     * Verifies the service health endpoint is reachable before tests proceed.
     * Subclasses can call this in @BeforeAll if they want fast-fail behaviour.
     */
    protected static void assertServiceHealthy() {
        try {
            io.restassured.RestAssured.given()
                    .baseUri(baseUrl)
                    .get("/health")
                    .then()
                    .statusCode(200);
        } catch (Exception e) {
            throw new IllegalStateException(
                    "Service not reachable at " + baseUrl + ". " +
                            "Start the service or set WALLET_SERVICE_URL env var.", e);
        }
    }

    /**
     * Opens a raw JDBC connection to the Testcontainer database.
     * Caller is responsible for closing it.
     */
    protected Connection openDbConnection() throws SQLException {
        return DriverManager.getConnection(
                postgres.getJdbcUrl(),
                postgres.getUsername(),
                postgres.getPassword()
        );
    }
}
