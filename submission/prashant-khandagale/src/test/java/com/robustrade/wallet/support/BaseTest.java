package com.robustrade.wallet.support;

import com.robustrade.wallet.Main;
import com.robustrade.wallet.db.Database;
import com.sun.net.httpserver.HttpServer;
import io.restassured.RestAssured;
import org.testng.annotations.AfterSuite;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.BeforeSuite;

import java.io.IOException;

/**
 * Every test class extends this.
 *
 * What it gives you:
 *  - ONE real instance of the service (real embedded HTTP server, real H2
 *    file database) running for the whole suite -- tests are genuine HTTP
 *    calls against a running service, not in-process method calls.
 *  - all tables wiped before each test CLASS starts, so a test never sees
 *    leftover rows from a previous class (avoids false positives from stale
 *    data) without paying the cost of restarting the server per test method.
 *  - ready-to-use helpers: `api` (RestAssured wrapper), `db` (direct-SQL
 *    assertions), `testData` (wallet/request builders).
 */
public abstract class BaseTest {

    protected static final int PORT = 8089;
    protected static final String JDBC_URL =
            "jdbc:h2:file:./data/test-walletdb;DB_CLOSE_ON_EXIT=FALSE;AUTO_SERVER=TRUE";

    private static HttpServer server;
    private static Database database;

    protected TransferApiClient api;
    protected DbVerifier db;
    protected TestData testData;

    @BeforeSuite(alwaysRun = true)
    public void startServerOnce() throws IOException {
        if (server == null) {
            database = new Database(JDBC_URL);
            server = Main.start(PORT, JDBC_URL);
            RestAssured.baseURI = "http://localhost:" + PORT;
        }
    }

    @AfterSuite(alwaysRun = true)
    public void stopServer() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
    }

    @BeforeClass(alwaysRun = true)
    public void resetDataForThisClass() {
        database.resetAllData();
        api = new TransferApiClient();
        db = new DbVerifier(database);
        testData = new TestData(database);
    }
}
