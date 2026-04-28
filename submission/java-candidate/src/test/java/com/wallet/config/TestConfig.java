package com.wallet.config;

/**
 * All the config the test suite needs in one place.
 * Each value checks a system property first, then an env var, then falls back to a default.
 * This way the same tests work locally and in CI without changing any code.
 */
public final class TestConfig {

    // not meant to be instantiated
    private TestConfig() {}

    /** Base URL of the Wallet Transfer Service under test. */
    public static final String SERVICE_BASE_URL =
            System.getProperty("service.base.url",
                    System.getenv().getOrDefault("SERVICE_BASE_URL", "http://localhost:8080"));

    /** JDBC URL for the database that backs the service (used for DB assertions). */
    public static final String DB_URL =
            System.getProperty("db.url",
                    System.getenv().getOrDefault("DB_URL", ""));

    // blank DB_URL = use Testcontainers; set it to point at a real DB in CI
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

