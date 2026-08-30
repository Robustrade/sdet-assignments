package tests;

import org.junit.jupiter.api.BeforeEach;

import Containers.PostgresContainer;
import utils.DatabaseSchema;
import utils.DatabaseUtils;
import utils.TestData;

public class BaseDatabaseTest {

    @BeforeEach
    public void setupDatabase() throws Exception {

        // Configure Testcontainers database
        DatabaseUtils.configureDatabase(
                PostgresContainer.postgres.getJdbcUrl(),
                PostgresContainer.postgres.getUsername(),
                PostgresContainer.postgres.getPassword()
        );

        // Reset database
        DatabaseSchema.resetDatabase();

        // Create tables
        DatabaseSchema.createTables();

        // Insert fresh test data
        TestData.createWallets();

        System.out.println("Test database setup completed!");
    }
}