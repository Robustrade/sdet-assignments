package tests;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import Containers.PostgresContainer;
import api.TransferApiServer;
import io.restassured.RestAssured;
import io.restassured.response.Response;
import utils.DatabaseSchema;
import utils.DatabaseUtils;
import utils.TestData;

public class TransferApiTest {

	private static TransferApiServer apiServer;

	@BeforeAll
	public static void startApiServer() throws Exception {

		// Configure database
		DatabaseUtils.configureDatabase(PostgresContainer.postgres.getJdbcUrl(),
				PostgresContainer.postgres.getUsername(), PostgresContainer.postgres.getPassword());

		// Start API server
		apiServer = new TransferApiServer();
		apiServer.start();

		RestAssured.baseURI = "http://localhost:8080";

		System.out.println("API test environment ready!");
	}

	@BeforeEach
	public void resetTestDatabase() throws Exception {

		// Give every API test a fresh database state
		DatabaseSchema.resetDatabase();
		DatabaseSchema.createTables();
		TestData.createWallets();

		System.out.println("API test database reset successfully!");
	}

	@AfterAll
	public static void stopApiServer() {

		if (apiServer != null) {
			apiServer.stop();
		}

		System.out.println("API test environment stopped!");
	}

	// ============================================================
	// TEST 1 - Successful Transfer
	// ============================================================

	@Test
	public void testSuccessfulTransferThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-test-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("API response status: " + response.statusCode());

		System.out.println("API response body: " + response.asString());

		// API validation
		assertEquals(200, response.statusCode());

		assertEquals("completed", response.jsonPath().getString("status"));

		// Database validation
		BigDecimal sourceBalance = DatabaseUtils.getWalletBalance(1001);

		BigDecimal destinationBalance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("900.00"), sourceBalance);

		assertEquals(new BigDecimal("600.00"), destinationBalance);

		// Verify exactly one transfer record
		assertEquals(1, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("API response, wallet balances and transfer database record verified successfully!");
	}

	// ============================================================
	// TEST 2 - Duplicate Transfer / Idempotency
	// ============================================================

	@Test
	public void testDuplicateTransferThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-duplicate-001";

		// First request
		Response firstResponse = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("First response: " + firstResponse.asString());

		assertEquals(200, firstResponse.statusCode());

		// Second request with SAME idempotency key
		Response secondResponse = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Second response: " + secondResponse.asString());

		assertEquals(200, secondResponse.statusCode());

		// Verify wallet was debited only once
		BigDecimal sourceBalance = DatabaseUtils.getWalletBalance(1001);

		BigDecimal destinationBalance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("900.00"), sourceBalance);

		assertEquals(new BigDecimal("600.00"), destinationBalance);

		// Verify only one transfer exists
		assertEquals(1, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Duplicate API request handled correctly with exactly one transfer!");
	}

	// ============================================================
	// TEST 3 - Insufficient Balance
	// ============================================================

	@Test
	public void testInsufficientBalanceThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 2000
				}
				""";

		String idempotencyKey = "api-insufficient-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Insufficient balance response status: " + response.statusCode());

		System.out.println("Insufficient balance response body: " + response.asString());

		assertEquals(400, response.statusCode());

		assertEquals("Insufficient balance in wallet: 1001", response.jsonPath().getString("error"));

		// Balances must remain unchanged
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		// No transfer should be created
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println(
				"Insufficient balance handled correctly. " + "Balances unchanged and no transfer record created!");
	}

	// ============================================================
	// TEST 4 - Blank Idempotency Key
	// ============================================================

	@Test
	public void testBlankIdempotencyKeyThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		Response response = RestAssured.given().header("Idempotency-Key", " ").contentType("application/json")
				.body(requestBody).when().post("/transfers");

		System.out.println("Blank idempotency key response status: " + response.statusCode());

		System.out.println("Blank idempotency key response body: " + response.asString());

		assertEquals(400, response.statusCode());

		assertEquals("Idempotency key must not be null or blank", response.jsonPath().getString("error"));

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		System.out.println("Blank idempotency key handled correctly. " + "Balances remain unchanged!");
	}

	// ============================================================
	// TEST 5 - Zero Amount
	// ============================================================

	@Test
	public void testZeroAmountThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 0
				}
				""";

		String idempotencyKey = "api-zero-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Zero amount response status: " + response.statusCode());

		System.out.println("Zero amount response body: " + response.asString());

		assertEquals(400, response.statusCode());

		assertEquals("Transfer amount must be greater than zero", response.jsonPath().getString("error"));

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Zero amount handled correctly. " + "Balances unchanged and no transfer record created!");
	}

	// ============================================================
	// TEST 6 - Negative Amount
	// ============================================================

	@Test
	public void testNegativeAmountThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": -100
				}
				""";

		String idempotencyKey = "api-negative-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(400, response.statusCode());

		assertEquals("Transfer amount must be greater than zero", response.jsonPath().getString("error"));

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Negative amount handled correctly.");
	}

	// ============================================================
	// TEST 7 - More Than 2 Decimal Places
	// ============================================================

	@Test
	public void testAmountWithMoreThanTwoDecimalPlaces() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100.123
				}
				""";

		String idempotencyKey = "api-decimal-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(400, response.statusCode());

		assertEquals("Transfer amount cannot have more than 2 decimal places", response.jsonPath().getString("error"));

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Amount with more than two decimal places handled correctly.");
	}
	
	// TEST 9 - Destination Wallet Does Not Exist

	@Test
	public void testDestinationWalletNotFoundThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 9999,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-destination-not-found-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(400, response.statusCode());

		assertEquals("Destination wallet not found: 9999", response.jsonPath().getString("error"));

		// Transaction rollback should restore source balance
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Destination wallet not found handled correctly and transaction rolled back.");
	}

	// ============================================================
	// TEST 10 - Missing Source Wallet ID
	// ============================================================

	@Test
	public void testMissingSourceWalletIdThroughApi() throws Exception {

		String requestBody = """
				{
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-missing-source-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(400, response.statusCode());

		System.out.println("Missing source wallet ID handled correctly.");
	}

	// ============================================================
	// TEST 12 - Missing Amount
	// ============================================================

	@Test
	public void testMissingAmountThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002
				}
				""";

		String idempotencyKey = "api-missing-amount-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(400, response.statusCode());

		System.out.println("Missing amount handled correctly.");
	}

	// ============================================================
	// TEST 13 - GET Method Not Allowed
	// ============================================================

	@Test
	public void testGetMethodNotAllowed() throws Exception {

		Response response = RestAssured.given().when().get("/transfers");

		assertEquals(405, response.statusCode());

		assertEquals("Method not allowed", response.jsonPath().getString("error"));

		System.out.println("GET method correctly rejected with 405.");
	}

	// ============================================================
	// TEST 14 - Successful Decimal Transfer
	// ============================================================

	@Test
	public void testSuccessfulDecimalTransferThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100.50
				}
				""";

		String idempotencyKey = "api-decimal-success-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(200, response.statusCode());

		assertEquals("completed", response.jsonPath().getString("status"));

		assertEquals(new BigDecimal("899.50"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("600.50"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(1, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Decimal transfer handled correctly.");
	}

	// ============================================================
	// TEST 15 - Transfer Status in Database
	// ============================================================

	@Test
	public void testTransferStatusInDatabase() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-status-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(200, response.statusCode());

		assertEquals("completed", DatabaseUtils.getTransferStatus(idempotencyKey));

		System.out.println("Transfer status verified successfully.");
	}

	// ============================================================
	// TEST 16 - Transfer Details in Database
	// ============================================================

	@Test
	public void testTransferDetailsInDatabase() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-details-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(200, response.statusCode());

		Object[] details = DatabaseUtils.getTransferDetails(idempotencyKey);

		assertEquals(idempotencyKey, details[0]);

		assertEquals(1001L, details[1]);

		assertEquals(1002L, details[2]);

		assertEquals(new BigDecimal("100.00"), details[3]);

		assertEquals("completed", details[4]);

		System.out.println("Transfer details verified successfully.");
	}

	// ============================================================
	// TEST 17 - Transaction Rollback
	// ============================================================

	@Test
	public void testTransactionRollbackThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 9999,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-rollback-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		assertEquals(400, response.statusCode());

		// Source balance must be restored after rollback
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		// No transfer record
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Transaction rollback verified successfully.");
	}

	@Test
	public void testSameSourceAndDestinationWalletThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1001,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-same-wallet-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Same wallet response status: " + response.statusCode());

		System.out.println("Same wallet response body: " + response.asString());

		// API must reject same source and destination wallet
		assertEquals(400, response.statusCode());

		assertEquals("Source and destination wallets cannot be the same", response.jsonPath().getString("error"));

		// Balance must remain unchanged
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		// No transfer record should be created
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Same source and destination wallet handled correctly. "
				+ "Balance unchanged and no transfer record created!");
	}
	
	@Test
	public void testSourceWalletNotFound() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 9999,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-source-not-found-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Source wallet not found response status: " + response.statusCode());

		System.out.println("Source wallet not found response body: " + response.asString());

		// Verify API response
		assertEquals(400, response.statusCode());

		assertEquals("Source wallet not found: 9999", response.jsonPath().getString("error"));

		// Verify destination wallet remains unchanged
		BigDecimal destinationBalance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("500.00"), destinationBalance);

		// Verify no transfer record was created
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Source wallet not found handled correctly. "
				+ "Destination balance unchanged and no transfer record created!");
	}

	@Test
	public void testMissingDestinationWalletId() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-missing-destination-wallet-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Missing destination wallet response status: " + response.statusCode());

		System.out.println("Missing destination wallet response body: " + response.asString());

		// Verify API response
		assertEquals(400, response.statusCode());

		assertEquals("Missing required field: destination_wallet_id", response.jsonPath().getString("error"));

		// Verify source wallet balance remains unchanged
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		// Verify destination wallet remains unchanged
		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		// Verify no transfer record was created
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Missing destination wallet ID handled correctly. "
				+ "Balances unchanged and no transfer record created!");
	}

	@Test
	public void testMalformedJson() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				""";

		String idempotencyKey = "api-malformed-json-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Malformed JSON response status: " + response.statusCode());

		System.out.println("Malformed JSON response body: " + response.asString());

		// Verify API rejects malformed JSON
		assertEquals(400, response.statusCode());

		// Verify wallet balances remain unchanged
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		// Verify no transfer record was created
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Malformed JSON handled correctly. " + "Balances unchanged and no transfer record created!");
	}

	@Test
	public void testConcurrentTransfersThroughApi() throws Exception {

		String requestBody1 = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 700
				}
				""";

		String requestBody2 = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 700
				}
				""";

		Thread thread1 = new Thread(() -> {

			Response response = RestAssured.given().header("Idempotency-Key", "concurrent-transfer-001")
					.contentType("application/json").body(requestBody1).when().post("/transfers");

			System.out.println("Concurrent request 1: " + response.statusCode() + " - " + response.asString());
		});

		Thread thread2 = new Thread(() -> {

			Response response = RestAssured.given().header("Idempotency-Key", "concurrent-transfer-002")
					.contentType("application/json").body(requestBody2).when().post("/transfers");

			System.out.println("Concurrent request 2: " + response.statusCode() + " - " + response.asString());
		});

		// Start both requests
		thread1.start();
		thread2.start();

		// Wait for both requests to finish
		thread1.join();
		thread2.join();

		// Check final balances
		BigDecimal sourceBalance = DatabaseUtils.getWalletBalance(1001);

		BigDecimal destinationBalance = DatabaseUtils.getWalletBalance(1002);

		System.out.println("Final source balance: " + sourceBalance);

		System.out.println("Final destination balance: " + destinationBalance);

		/*
		 * Only one transfer of 700 can succeed because source wallet initially contains
		 * 1000.
		 */
		assertTrue(sourceBalance.equals(new BigDecimal("300.00")) || sourceBalance.equals(new BigDecimal("1000.00")));

		assertTrue(destinationBalance.equals(new BigDecimal("1200.00"))
				|| destinationBalance.equals(new BigDecimal("500.00")));

		System.out.println("Concurrent transfers handled correctly. " + "Wallet was not overdrawn!");
	}

	@Test
	public void testMissingIdempotencyKeyThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		Response response = RestAssured.given().contentType("application/json").body(requestBody).when()
				.post("/transfers");

		System.out.println("Missing idempotency key response status: " + response.statusCode());

		System.out.println("Missing idempotency key response body: " + response.asString());

		// Verify API rejects missing idempotency key
		assertEquals(400, response.statusCode());

		assertEquals("Idempotency key must not be null or blank", response.jsonPath().getString("error"));

		// Verify balances remain unchanged
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		System.out.println("Missing idempotency key handled correctly. " + "Balances remain unchanged!");
	}

	@Test
	public void testInvalidContentTypeThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-invalid-content-type-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey).contentType("text/plain")
				.body(requestBody).when().post("/transfers");

		System.out.println("Invalid content type response status: " + response.statusCode());

		System.out.println("Invalid content type response body: " + response.asString());

		// API should reject unsupported content type
		assertEquals(400, response.statusCode());

		// Verify balances remain unchanged
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		// Verify no transfer was created
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println(
				"Invalid content type handled correctly. " + "Balances unchanged and no transfer record created!");
	}

	@Test
	public void testMissingContentTypeThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-missing-content-type-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey).body(requestBody).when()
				.post("/transfers");

		System.out.println("Missing content type response status: " + response.statusCode());

		System.out.println("Missing content type response body: " + response.asString());

		// API should reject missing Content-Type
		assertEquals(400, response.statusCode());

		assertEquals("Content-Type must be application/json", response.jsonPath().getString("error"));

		// Verify balances remain unchanged
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		// Verify no transfer was created
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println(
				"Missing content type handled correctly. " + "Balances unchanged and no transfer record created!");
	}

	@Test
	public void testTransferEntireSourceBalanceThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 1000.00
				}
				""";

		String idempotencyKey = "api-full-balance-transfer-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Full balance transfer response status: " + response.statusCode());

		System.out.println("Full balance transfer response body: " + response.asString());

		// Verify API response
		assertEquals(200, response.statusCode());

		assertEquals("completed", response.jsonPath().getString("status"));

		// Source wallet should become zero
		assertEquals(new BigDecimal("0.00"), DatabaseUtils.getWalletBalance(1001));

		// Destination wallet should receive 1000
		assertEquals(new BigDecimal("1500.00"), DatabaseUtils.getWalletBalance(1002));

		// Verify exactly one transfer record
		assertEquals(1, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Entire source wallet balance transferred successfully.");
	}

	@Test
	public void testTransferAmountSlightlyGreaterThanBalanceThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 1000.01
				}
				""";

		String idempotencyKey = "api-balance-exceeded-by-one-cent-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Balance exceeded response status: " + response.statusCode());

		System.out.println("Balance exceeded response body: " + response.asString());

		// Verify API rejects the transfer
		assertEquals(400, response.statusCode());

		assertEquals("Insufficient balance in wallet: 1001", response.jsonPath().getString("error"));

		// Verify source balance is unchanged
		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		// Verify destination balance is unchanged
		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		// Verify no transfer record was created
		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Transfer exceeding available balance by one cent " + "handled correctly.");
	}

	@Test
	public void testMinimumValidTransferAmountThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 0.01
				}
				""";

		String idempotencyKey = "api-minimum-valid-amount-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Minimum amount response status: " + response.statusCode());

		System.out.println("Minimum amount response body: " + response.asString());

		// Verify API response
		assertEquals(200, response.statusCode());

		assertEquals("completed", response.jsonPath().getString("status"));

		// Verify balances
		assertEquals(new BigDecimal("999.99"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.01"), DatabaseUtils.getWalletBalance(1002));

		// Verify exactly one transfer record
		assertEquals(1, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Minimum valid transfer amount of 0.01 handled correctly.");
	}

	@Test
	public void testMissingSource_WalletIdThroughApi() throws Exception {

		String requestBody = """
				{
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-missing-source-id-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Missing source wallet ID response status: " + response.statusCode());

		System.out.println("Missing source wallet ID response body: " + response.asString());

		assertEquals(400, response.statusCode());

		assertEquals("Missing required field: source_wallet_id", response.jsonPath().getString("error"));

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Missing source wallet ID handled correctly.");
	}

	@Test
	public void testInvalidSourceWalletIdThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": "abc",
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-invalid-source-id-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Invalid source wallet ID response status: " + response.statusCode());

		System.out.println("Invalid source wallet ID response body: " + response.asString());

		assertEquals(400, response.statusCode());

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Invalid source wallet ID handled correctly.");
	}

	@Test
	public void testInvalidAmountThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": "abc"
				}
				""";

		String idempotencyKey = "api-invalid-amount-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Invalid amount response status: " + response.statusCode());

		System.out.println("Invalid amount response body: " + response.asString());

		assertEquals(400, response.statusCode());

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Invalid amount handled correctly.");
	}

	@Test
	public void testVeryLongIdempotencyKeyThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Long idempotency key response status: " + response.statusCode());

		System.out.println("Long idempotency key response body: " + response.asString());

		assertEquals(400, response.statusCode());

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		System.out.println("Very long idempotency key handled correctly.");
	}

	@Test
	public void testConcurrentDuplicateTransfersThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-concurrent-duplicate-001";

		int numberOfRequests = 5;

		java.util.concurrent.ExecutorService executor = java.util.concurrent.Executors
				.newFixedThreadPool(numberOfRequests);

		java.util.List<java.util.concurrent.Future<Response>> responses = new java.util.ArrayList<>();

		for (int i = 0; i < numberOfRequests; i++) {

			responses.add(executor.submit(() -> RestAssured.given().header("Idempotency-Key", idempotencyKey)
					.contentType("application/json").body(requestBody).when().post("/transfers")));
		}

		executor.shutdown();

		for (java.util.concurrent.Future<Response> future : responses) {

			Response response = future.get();

			System.out.println("Concurrent response status: " + response.statusCode());

			System.out.println("Concurrent response body: " + response.asString());

			assertEquals(200, response.statusCode());

			assertEquals("completed", response.jsonPath().getString("status"));
		}

		// Only one transfer should actually be created
		assertEquals(1, DatabaseUtils.getTransferCount(idempotencyKey));

		// Wallets should be debited/credited only once
		assertEquals(new BigDecimal("900.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("600.00"), DatabaseUtils.getWalletBalance(1002));

		System.out.println("Concurrent duplicate requests handled correctly. " + "Exactly one transfer was processed.");
	}

	@Test
	public void testIdempotencyKeyReuseWithDifferentRequestThroughApi() throws Exception {

		String firstRequestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String secondRequestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 200
				}
				""";

		String idempotencyKey = "api-key-reuse-different-request-001";

		// First request
		Response firstResponse = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(firstRequestBody).when().post("/transfers");

		System.out.println("First request status: " + firstResponse.statusCode());

		System.out.println("First request body: " + firstResponse.asString());

		assertEquals(200, firstResponse.statusCode());

		// Second request uses SAME key but different amount
		Response secondResponse = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(secondRequestBody).when().post("/transfers");

		System.out.println("Second request status: " + secondResponse.statusCode());

		System.out.println("Second request body: " + secondResponse.asString());

		// The original transfer must not be processed again
		assertEquals(200, secondResponse.statusCode());

		// Only the first transfer should affect balances
		assertEquals(new BigDecimal("900.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("600.00"), DatabaseUtils.getWalletBalance(1002));

		// Exactly one transfer record
		assertEquals(1, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Idempotency key reuse handled correctly. " + "Only the original transfer was processed.");
	}

	// ============================================================
	// TEST 41 - Unknown JSON field
	// ============================================================

	@Test
	public void testUnknownJsonFieldThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 1001,
				    "destination_wallet_id": 1002,
				    "amount": 100,
				    "unknown_field": "test"
				}
				""";

		String idempotencyKey = "api-unknown-field-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Unknown field response status: " + response.statusCode());

		System.out.println("Unknown field response body: " + response.asString());

		/*
		 * The current API parser ignores unknown fields, so the valid transfer should
		 * still succeed.
		 */
		assertEquals(200, response.statusCode());

		assertEquals("completed", response.jsonPath().getString("status"));

		assertEquals(new BigDecimal("900.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("600.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(1, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Unknown JSON field handled correctly.");
	}

	// ============================================================
	// TEST 42 - Zero destination/source IDs
	// ============================================================

	@Test
	public void testZeroWalletIdThroughApi() throws Exception {

		String requestBody = """
				{
				    "source_wallet_id": 0,
				    "destination_wallet_id": 1002,
				    "amount": 100
				}
				""";

		String idempotencyKey = "api-zero-wallet-id-001";

		Response response = RestAssured.given().header("Idempotency-Key", idempotencyKey)
				.contentType("application/json").body(requestBody).when().post("/transfers");

		System.out.println("Zero wallet ID response status: " + response.statusCode());

		System.out.println("Zero wallet ID response body: " + response.asString());

		assertEquals(400, response.statusCode());

		assertEquals("Source wallet not found: 0", response.jsonPath().getString("error"));

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));

		assertEquals(0, DatabaseUtils.getTransferCount(idempotencyKey));

		System.out.println("Zero wallet ID handled correctly.");
	}

}
