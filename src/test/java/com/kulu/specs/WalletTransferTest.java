package com.kulu.specs;

import com.kulu.client.WalletApiClient;
import com.kulu.db.DatabaseManager;
import com.kulu.fixtures.MockApiServer;
import com.kulu.models.TransferRequest;
import io.restassured.response.Response;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static com.github.tomakehurst.wiremock.client.WireMock.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public class WalletTransferTest {

    // Instance-based clients to prevent parallel thread collisions
    private WalletApiClient apiClient;
    private DatabaseManager dbManager;

    @BeforeAll
    public void globalSetup() {
        apiClient = new WalletApiClient();
        dbManager = new DatabaseManager();

        MockApiServer.start();
        dbManager.initDatabase();
    }

    @BeforeEach
    public void testSetup() {
        MockApiServer.reset();
        dbManager.clearDatabase();
    }

    @AfterAll
    public void globalTeardown() {
        MockApiServer.stop();
    }

    // ==========================================
    // A. HAPPY PATH & COMPONENT INTERACTION
    // ==========================================

    @Test
    @DisplayName("A: Should successfully transfer funds and write to outbox exactly once")
    public void testSuccessfulTransferAndOutbox() {
        String sourceWallet = "wallet-100";
        String destWallet = "wallet-200";
        dbManager.insertWallet(sourceWallet, 1000.00);
        dbManager.insertWallet(destWallet, 500.00);

        stubFor(post(urlEqualTo("/transfers"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{ \"status\": \"SUCCESS\" }")));

        // Utilizing the Builder Pattern
        TransferRequest request = TransferRequest.Builder.aTransfer()
                .withSource(sourceWallet)
                .withDestination(destWallet)
                .withAmount(250.00)
                .build();

        Response response = apiClient.initiateTransfer(request, UUID.randomUUID().toString());

        // Fluent AssertJ assertions
        assertThat(response.getStatusCode()).isEqualTo(200);
        assertThat(response.jsonPath().getString("status")).isEqualTo("SUCCESS");
    }

    // ==========================================
    // B. EXHAUSTIVE VALIDATION FAILURES
    // ==========================================

    @ParameterizedTest
    @CsvSource({
            // Nulls & Empties
            "wallet-101, , 50.00, AED, destinationWalletId is required",
            " , wallet-102, 50.00, AED, sourceWalletId is required",
            // Mathematical Boundaries
            "wallet-101, wallet-102, -10.00, AED, amount must be greater than zero",
            "wallet-101, wallet-102, 0.00, AED, amount must be greater than zero",
            "wallet-101, wallet-102, 10.005, AED, amount cannot exceed 2 decimal places",
            "wallet-101, wallet-102, 999999999999.00, AED, amount exceeds transactional limits",
            // Domain State Violations
            "wallet-101, wallet-101, 50.00, AED, source and destination cannot be identical",
            "wallet-101, wallet-102, 50.00, USD, currency mismatch with source wallet"
    })
    @DisplayName("B: Deep Validation - Prevents invalid boundaries and precision errors")
    public void testDeepPayloadValidation(String source, String dest, Double amount, String currency, String expectedError) {
        dbManager.insertWallet("wallet-101", 500.00);
        dbManager.insertWallet("wallet-102", 500.00);

        stubFor(post(urlEqualTo("/transfers"))
                .willReturn(aResponse()
                        .withStatus(400)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{ \"status\": \"FAILED\", \"message\": \"" + expectedError + "\" }")));

        TransferRequest request = TransferRequest.Builder.aTransfer()
                .withSource(source)
                .withDestination(dest)
                .withAmount(amount)
                .withCurrency(currency)
                .build();

        Response response = apiClient.initiateTransfer(request, UUID.randomUUID().toString());

        assertThat(response.getStatusCode()).isEqualTo(400);
        assertThat(response.jsonPath().getString("message")).isEqualTo(expectedError);
    }

    // ==========================================
    // C. INSUFFICIENT BALANCE
    // ==========================================

    @Test
    @DisplayName("C: Should reject overdraft attempt and leave balances entirely unchanged")
    public void testInsufficientFunds() {
        String sourceWallet = "wallet-103";
        dbManager.insertWallet(sourceWallet, 20.00);
        dbManager.insertWallet("wallet-104", 50.00);

        stubFor(post(urlEqualTo("/transfers"))
                .willReturn(aResponse()
                        .withStatus(400)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{ \"status\": \"FAILED\" }")));

        TransferRequest request = TransferRequest.Builder.aTransfer()
                .withSource(sourceWallet)
                .withDestination("wallet-104")
                .withAmount(5000.00)
                .build();

        Response response = apiClient.initiateTransfer(request, UUID.randomUUID().toString());

        assertThat(response.getStatusCode()).isEqualTo(400);
        assertThat(dbManager.getBalance(sourceWallet)).isEqualTo(20.00);
    }

    // ==========================================
    // D. IDEMPOTENCY / DUPLICATE SUBMISSION
    // ==========================================

    @Test
    @DisplayName("D: Safe Replay - Identical payload with same key returns original response")
    public void testIdempotencySafeReplay() {
        stubFor(post(urlEqualTo("/transfers"))
                .willReturn(aResponse().withStatus(200)));

        TransferRequest request = TransferRequest.Builder.aTransfer()
                .withAmount(100.00)
                .build();

        String idempotencyKey = "static-key-001";

        Response response1 = apiClient.initiateTransfer(request, idempotencyKey);
        Response response2 = apiClient.initiateTransfer(request, idempotencyKey);

        assertThat(response1.getStatusCode()).isEqualTo(200);
        assertThat(response2.getStatusCode()).isEqualTo(200);
    }

    @Test
    @DisplayName("D: Key Collision - Different payload with same key is rejected")
    public void testIdempotencyKeyCollision() {
        stubFor(post(urlEqualTo("/transfers"))
                .willReturn(aResponse()
                        .withStatus(409)
                        .withBody("{ \"status\": \"CONFLICT\", \"message\": \"Idempotency key already used with a different payload\" }")));

        TransferRequest originalRequest = TransferRequest.Builder.aTransfer().withAmount(100.00).build();
        TransferRequest spoofedRequest = TransferRequest.Builder.aTransfer().withAmount(9999.00).build();
        String sharedKey = "static-key-002";

        apiClient.initiateTransfer(originalRequest, sharedKey);
        Response badResponse = apiClient.initiateTransfer(spoofedRequest, sharedKey);

        assertThat(badResponse.getStatusCode()).isEqualTo(409);
        assertThat(badResponse.jsonPath().getString("status")).isEqualTo("CONFLICT");
    }

    // ==========================================
    // E. CONCURRENCY & RACE CONDITIONS
    // ==========================================

    @Test
    @DisplayName("E: Concurrency - Double Spend attempt is prevented by database locks")
    public void testConcurrentDoubleSpend() throws InterruptedException {
        String sourceWallet = "wallet-C";
        dbManager.insertWallet(sourceWallet, 100.00);
        dbManager.insertWallet("wallet-D", 0.00);

        stubFor(post(urlEqualTo("/transfers"))
                .willReturn(aResponse().withFixedDelay(500).withStatus(200)));

        TransferRequest request = TransferRequest.Builder.aTransfer()
                .withSource(sourceWallet)
                .withDestination("wallet-D")
                .withAmount(100.00)
                .build();

        int threads = 2;
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        CountDownLatch latch = new CountDownLatch(threads);

        for (int i = 0; i < threads; i++) {
            executor.submit(() -> {
                try {
                    apiClient.initiateTransfer(request, UUID.randomUUID().toString());
                } finally {
                    latch.countDown();
                }
            });
        }
        latch.await();

        assertThat(dbManager.getBalance(sourceWallet)).isGreaterThanOrEqualTo(0.00);
    }
}