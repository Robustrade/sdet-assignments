package com.wallet.fixture.db;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import javax.sql.DataSource;

/**
 * Boots a real throwaway PostgreSQL (Zonky embedded) and applies schema.sql. One instance is shared
 * for the whole test run; tables are truncated between tests instead of restarting the database.
 */
public class Database {

	private final EmbeddedPostgres postgres;
	private final DataSource dataSource;

	private Database(EmbeddedPostgres postgres) {
		this.postgres = postgres;
		this.dataSource = postgres.getPostgresDatabase();
	}

	public static Database start() {
		try {
			EmbeddedPostgres postgres = EmbeddedPostgres.builder().start();
			Database database = new Database(postgres);
			database.applySchema();
			return database;
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to start embedded PostgreSQL", e);
		}
	}

	private void applySchema() {
		String schemaSql = readResource("/schema.sql");
		try (Connection connection = dataSource.getConnection();
				Statement statement = connection.createStatement()) {
			statement.execute(schemaSql);
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to apply schema.sql", e);
		}
	}

	private static String readResource(String resourcePath) {
		try (var stream = Database.class.getResourceAsStream(resourcePath)) {
			if (stream == null) {
				throw new IllegalStateException("Resource not found on classpath: " + resourcePath);
			}
			return new String(stream.readAllBytes());
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to read " + resourcePath, e);
		}
	}

	public DataSource dataSource() {
		return dataSource;
	}

	/** Wipes all tables so no test observes another test's rows. */
	public void truncateAll() {
		String sql = "TRUNCATE TABLE outbox_events, transfer_events, idempotency_keys, transfers, wallets"
				+ " RESTART IDENTITY CASCADE";
		try (Connection connection = dataSource.getConnection();
				Statement statement = connection.createStatement()) {
			statement.execute(sql);
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to truncate tables", e);
		}
	}

	public void stop() {
		try {
			postgres.close();
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to stop embedded PostgreSQL", e);
		}
	}
}
