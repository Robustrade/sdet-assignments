
package Containers;

import org.testcontainers.containers.PostgreSQLContainer;

public class PostgresContainer {

    public static final PostgreSQLContainer<?> postgres =
            new PostgreSQLContainer<>("postgres:16")
                    .withDatabaseName("walletd")
                    .withUsername("testname")
                    .withPassword("test4523");

    static {
        postgres.start();
    }
}