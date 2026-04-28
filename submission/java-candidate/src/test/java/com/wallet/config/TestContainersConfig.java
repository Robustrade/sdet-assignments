package com.wallet.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Manages a shared PostgreSQL Testcontainer used by the test suite for DB-level assertions.
 *
 * NOTE: This container represents the *same* database that the service under test writes to.
 * In a real environment you would point DB_URL at the service's actual database instead of
 * starting a fresh container. In this test project the container is also used by the
 * optional embedded-stub mode.
 *
 * The container is started once for the entire JVM via a static initialiser and reused across
 * test classes (Testcontainers "singleton" pattern).
 */
public final class TestContainersConfig {

    private static final Logger log = LoggerFactory.getLogger(TestContainersConfig.class);

    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("wallet_test")
                    .withUsername("wallet")
                    .withPassword("wallet")
                    .withReuse(true);   // reuse across Maven forks if TC_REUSE_ENABLE=true
//
//    static {
//        POSTGRES.start();
//        log.info("PostgreSQL container started at {}", POSTGRES.getJdbcUrl());
//        applySchema();
//    }

    static {
        System.setProperty("DOCKER_HOST", "unix:///Users/sweta/.docker/run/docker.sock");
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");

        try {
            log.info("Starting PostgreSQL container...");
            POSTGRES.start();
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

    public static String getJdbcUrl()  { return POSTGRES.getJdbcUrl(); }
    public static String getUser()     { return POSTGRES.getUsername(); }
    public static String getPassword() { return POSTGRES.getPassword(); }

    // --------------------------------------
    //  Schema bootstrap
    // --------------------------------------

    private static void applySchema() {
        try (Connection conn = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             Statement stmt = conn.createStatement()) {

            // Read schema from classpath resource
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
