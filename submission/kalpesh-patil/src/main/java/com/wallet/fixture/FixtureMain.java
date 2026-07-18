package com.wallet.fixture;

import com.wallet.fixture.db.Database;
import com.wallet.fixture.http.WalletTransferServer;

/**
 * Standalone entry point for manually running the fixture (curl/Postman exploration on :8080).
 * The automated suite does NOT use this class -- it manages the database and server directly for
 * per-test isolation. See TestEnvironmentManager on the test side.
 */
public class FixtureMain {

	private static final int PORT = 8080;

	private FixtureMain() {
	}

	public static void main(String[] args) {
		Database database = Database.start();
		WalletTransferServer server = WalletTransferServer.start(database.dataSource(), PORT);
		Runtime.getRuntime().addShutdownHook(new Thread(() -> {
			server.stop();
			database.stop();
		}));
		System.out.println("Wallet Transfer Service fixture listening on http://localhost:" + PORT);
	}
}
