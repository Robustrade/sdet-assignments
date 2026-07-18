package com.api.utils;

import javax.sql.DataSource;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.wallet.fixture.db.Database;
import com.wallet.fixture.http.WalletTransferServer;

/**
 * Starts embedded PostgreSQL and the service fixture once per test run (startup costs seconds,
 * so all classes share it). Tables are truncated between tests via resetDatabase().
 */
public class TestEnvironmentManager {

	private static final Logger LOGGER = LogManager.getLogger(TestEnvironmentManager.class);
	private static TestEnvironmentManager instance;

	private final Database database;
	private final WalletTransferServer server;

	private TestEnvironmentManager() {
		LOGGER.info("Starting embedded PostgreSQL and wallet service fixture");
		this.database = Database.start();
		this.server = WalletTransferServer.start(database.dataSource(), 0);
		LOGGER.info("Wallet service fixture started on port {}", server.port());
		Runtime.getRuntime().addShutdownHook(new Thread(() -> {
			server.stop();
			database.stop();
		}));
	}

	public static synchronized TestEnvironmentManager getInstance() {
		if (instance == null) {
			instance = new TestEnvironmentManager();
		}
		return instance;
	}

	public String getBaseUri() {
		return "http://localhost:" + server.port();
	}

	public DataSource getDataSource() {
		return database.dataSource();
	}

	/** Truncates all tables so every test starts from a clean, known state. */
	public void resetDatabase() {
		database.truncateAll();
	}
}
