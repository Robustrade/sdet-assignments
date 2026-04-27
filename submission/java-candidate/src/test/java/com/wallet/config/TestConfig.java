package com.wallet.config;

/**
 * Central test configuration.
 *
 * Values can be overridden via environment variables or system properties so the
 * same test suite can run against a locally-started server, a Docker compose stack,
 * or a CI environment without code changes.
 *
 * The Testcontainers setup populates SERVICE_BASE_URL automatically when the
 * suite manages its own database container.
 */
public final class TestConfig {

    private TestConfig() {}

    /** Base URL of the Wallet Transfer Service under test. */
    public static final String SERVICE_BASE_URL =
            System.getProperty("service.base.url",
                    System.getenv().getOrDefault("SERVICE_BASE_URL", "http://localhost:8080"));

    /** JDBC URL for the database that backs the service (used for DB assertions). */
    public static final String DB_URL =
            System.getProperty("db.url",
                    System.getenv().getOrDefault("DB_URL", ""));

    public static final String DB_USER =
            System.getProperty("db.user",
                    System.getenv().getOrDefault("DB_USER", "postgres"));

    public static final String DB_PASSWORD =
            System.getProperty("db.password",
                    System.getenv().getOrDefault("DB_PASSWORD", "postgres"));

    /** Default currency used in test data. */
    public static final String DEFAULT_CURRENCY = "AED";

    /** Timeout (ms) used in retry/polling helpers. */
    public static final long RETRY_TIMEOUT_MS   = 5_000;
    public static final long RETRY_INTERVAL_MS  = 200;

    /** Thread count for concurrency tests. */
    public static final int CONCURRENCY_THREADS = 10;
}

