package tests;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.SQLException;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import Containers.PostgresContainer;
import utils.DatabaseSchema;
import utils.DatabaseUtils;
import utils.TestData;

public class PostgresContainerTest {

	@BeforeEach
	public void configureDatabase() {

		DatabaseUtils.configureDatabase(PostgresContainer.postgres.getJdbcUrl(),
				PostgresContainer.postgres.getUsername(), PostgresContainer.postgres.getPassword());
	}

	@Test
	public void testDatabaseConnection() throws Exception {

		Connection connection = DatabaseUtils.getConnection();

		System.out.println("Database connected successfully!");
		System.out.println("Database: " + connection.getCatalog());

		connection.close();
	}

	@Test
	public void testCreateTables() throws SQLException {

		DatabaseSchema.createTables();

		System.out.println("Tables created successfully!");
	}

	@Test
	public void testCreateWallets() throws SQLException {

		TestData.createWallets();

		System.out.println("Wallet test data inserted successfully!");
	}

	@Test
	public void testWalletBalances() throws SQLException {

		BigDecimal wallet1Balance = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("1000.00"), wallet1Balance);

		assertEquals(new BigDecimal("500.00"), wallet2Balance);

		System.out.println("Wallet balances verified successfully!");
	}
}