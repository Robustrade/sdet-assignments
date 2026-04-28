package com.wallet.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Starts a Postgres container for the test suite and keeps it alive for the whole JVM.
 *
 * Started once via static init and reused across test classes — much faster than a fresh
 * container per class. Schema gets applied right after startup.
 *
 * If DB_URL is set in the environment, DbClient will skip this and connect externally instead.
 */
public final class TestContainersConfig {

    private static final Logger log = LoggerFactory.getLogger(TestContainersConfig.class);

    // using postgres 16 alpine to keep the image small
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("wallet_test")
                    .withUsername("wallet")
                    .withPassword("wallet")
                    .withReuse(true);   // reuse across Maven forks if TC_REUSE_ENABLE=true

    static {
        // point Docker at the right socket for macOS Docker Desktop
        System.setProperty("DOCKER_HOST", "unix:///Users/sweta/.docker/run/docker.sock");
        // ryuk can cause problems in some setups — easier to just disable it
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");

        try {
            log.info("Starting PostgreSQL container...");
            POSTGRES.start();
            // apply schema right after startup so the DB is ready for tests
            applySchema();
        } catch (Exception e) {
            log.error("CRITICAL: Docker environment not ready! Check if Docker Desktop is running.");
            // Giving a more descriptive error helps the next dev who runs this
            throw new ExceptionInInitializerError("Testcontainers failed to start. Tip: Run 'docker ps' or set TESTCONTAINERS_RYUK_DISABLED=true. Original error: " + e.getMessage());
        }
    }

    private TestContainersConfig() {}

    public static PostgreSQLContainer<?> getPostgres() {
        return POSTGRES;
    }

    // convenience accessors so callers don't need to touch the container directly
    public static String getJdbcUrl()  { return POSTGRES.getJdbcUrl(); }
    public static String getUser()     { return POSTGRES.getUsername(); }
    public static String getPassword() { return POSTGRES.getPassword(); }

    // ──────────────────────────────────────
    //  Schema bootstrap
    // ──────────────────────────────────────

    private static void applySchema() {
        try (Connection conn = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             Statement stmt = conn.createStatement()) {

            // schema.sql lives on the test classpath under /db/
            String schema = readResource("/db/schema.sql");
            stmt.execute(schema);
            log.info("Schema applied to test database");

        } catch (Exception e) {
            throw new RuntimeException("Failed to apply schema to test container", e);
        }
    }

    private static String readResource(String path) throws Exception {
        var url = TestContainersConfig.class.getResourceAsStream(path);
        if (url == null) throw new RuntimeException("Resource not found: " + path);
        return new String(url.readAllBytes());
    }
}
