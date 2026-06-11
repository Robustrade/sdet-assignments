package com.kulu.sdet.api;

import com.kulu.sdet.fixtures.IdempotencyKeyGenerator;
import com.kulu.sdet.fixtures.TransferRequestBuilder;
import com.kulu.sdet.fixtures.WalletBuilder;
import com.kulu.sdet.fixtures.WalletFixtures;
import com.kulu.sdet.model.TransferRequest;
import com.kulu.sdet.model.TransferResponse;
import com.kulu.sdet.model.Wallet;
import com.kulu.sdet.support.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

@Tag("insufficient-balance")
@Testcontainers
@DisplayName("Wallet Transfer — Insufficient Balance")
class WalletTransferInsufficientBalanceTest {


    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(TestConfig.DB_IMAGE).withDatabaseName(TestConfig.DB_NAME).withUsername(TestConfig.DB_USER).withPassword(TestConfig.DB_PASS);
    private static final BigDecimal SENDER_BALANCE = new BigDecimal("100.00");
    private static final BigDecimal RECEIVER_BALANCE = WalletFixtures.DEFAULT_BALANCE;
    private static final BigDecimal ONE_CENT_OVER = SENDER_BALANCE.add(new BigDecimal("0.01"));
    private WalletTransferClient client;
    private DbClient db;
    private WalletRepository wallets;
    private TransferRepository transfers;
    private BigDecimal senderBalanceBefore;
    private BigDecimal receiverBalanceBefore;

    static Stream<Arguments> insufficientBalanceRequests() {
        return Stream.of(

                Arguments.of("Amount greatly exceeds balance", TransferRequestBuilder.withInsufficientFunds().build()),

                Arguments.of("Amount exceeds balance by one cent (off-by-one boundary)", TransferRequestBuilder.aValidTransfer().withAmount(ONE_CENT_OVER).withKey(IdempotencyKeyGenerator.random()).build()),

                Arguments.of("Sender wallet has zero balance (empty wallet)", TransferRequestBuilder.aValidTransfer().withFromWalletId("wallet-empty").withAmount(new BigDecimal("1.00")).withKey(IdempotencyKeyGenerator.random()).build()));
    }

    @BeforeEach
    void setUp() throws Exception {
        db = new DbClient(POSTGRES);
        client = new WalletTransferClient();
        wallets = new WalletRepository(db);
        transfers = new TransferRepository(db);

        DatabaseSeeder.applySchema(db);

        Wallet sender = WalletBuilder.anAlphaWallet().withOwnerId("owner-alpha").withBalance(SENDER_BALANCE).build();

        Wallet receiver = WalletBuilder.aBetaWallet().withOwnerId("owner-beta").withBalance(RECEIVER_BALANCE).build();

        Wallet empty = WalletBuilder.anEmptyWallet().withId("wallet-empty").withOwnerId("owner-empty").build();

        DatabaseSeeder.seedWallets(db, sender, receiver, empty);

        senderBalanceBefore = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        assertNotNull(senderBalanceBefore, "Wallet not found in DB: " + WalletFixtures.WALLET_ALPHA);
        receiverBalanceBefore = wallets.balanceOf(WalletFixtures.WALLET_BETA);
        assertNotNull(receiverBalanceBefore, "Wallet not found in DB: " + WalletFixtures.WALLET_BETA);
    }

    @AfterEach
    void tearDown() throws Exception {
        db.close();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("insufficientBalanceRequests")
    @DisplayName("Transfer exceeding balance is rejected with no side effects")
    void transfer_insufficientBalance_rejectedWithNoSideEffects(String scenarioName, TransferRequest request) throws Exception {


        TransferResponse response = client.createTransfer(request);


        assertRejectionResponse(scenarioName, response);
        assertSenderBalanceUnchanged(scenarioName);
        assertReceiverBalanceUnchanged(scenarioName);
        assertNoCompletedTransactionRow(scenarioName);
        assertNoOutboxEvent(scenarioName);
        assertFailureAuditEventIfPresent(scenarioName);
    }

    @Test
    @DisplayName("Transfer of exactly the full sender balance is accepted (drain to zero allowed)")
    void transfer_exactBalance_accepted() throws Exception {
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withAmount(SENDER_BALANCE).withKey(IdempotencyKeyGenerator.random()).build();

        TransferResponse response = client.createTransfer(request);

        assertEquals(200, response.getStatusCode(), "Transferring exactly the full balance must succeed — drain to zero is valid. " + "error=" + response.getErrorMessage());
        assertEquals("COMPLETED", response.getStatus(), "Status must be COMPLETED when the full balance is transferred");


        BigDecimal senderAfter = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        assertNotNull(senderAfter, "Wallet not found in DB: " + WalletFixtures.WALLET_ALPHA);
        assertEquals(0, BigDecimal.ZERO.compareTo(senderAfter), "Sender balance must be exactly 0.00 after draining. actual=" + senderAfter);


        BigDecimal receiverAfter = wallets.balanceOf(WalletFixtures.WALLET_BETA);
        assertNotNull(receiverAfter, "Wallet not found in DB: " + WalletFixtures.WALLET_BETA);
        BigDecimal expectedReceiver = receiverBalanceBefore.add(SENDER_BALANCE);
        assertEquals(0, expectedReceiver.compareTo(receiverAfter), "Receiver balance must be receiver_before + sender_balance. " + "expected=" + expectedReceiver + " actual=" + receiverAfter);
    }


    private void assertRejectionResponse(String scenario, TransferResponse response) {
        assertEquals(422, response.getStatusCode(), String.format("[%s] Expected HTTP 422 Unprocessable Entity but got %d. " + "A 400 means the service is conflating input errors with business rule " + "violations; a 5xx means it crashed.", scenario, response.getStatusCode()));

        assertNotNull(response.getErrorMessage(), String.format("[%s] 422 response must include a human-readable 'error' field", scenario));

        assertTrue(response.getErrorMessage().toLowerCase().contains("insufficient") || response.getErrorMessage().toLowerCase().contains("balance") || response.getErrorMessage().toLowerCase().contains("funds"), String.format("[%s] Error message should mention insufficient balance/funds. " + "actual='%s'", scenario, response.getErrorMessage()));
    }


    private void assertSenderBalanceUnchanged(String scenario) throws Exception {
        BigDecimal senderAfter = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        assertNotNull(senderAfter, "Wallet not found in DB: " + WalletFixtures.WALLET_ALPHA);
        assertEquals(0, senderBalanceBefore.compareTo(senderAfter), String.format("[%s] Sender balance changed despite rejected transfer. " + "before=%s after=%s diff=%s", scenario, senderBalanceBefore, senderAfter, senderAfter.subtract(senderBalanceBefore)));
    }


    private void assertReceiverBalanceUnchanged(String scenario) throws Exception {
        BigDecimal receiverAfter = wallets.balanceOf(WalletFixtures.WALLET_BETA);
        assertNotNull(receiverAfter, "Wallet not found in DB: " + WalletFixtures.WALLET_BETA);
        assertEquals(0, receiverBalanceBefore.compareTo(receiverAfter), String.format("[%s] Receiver balance changed despite rejected transfer. " + "before=%s after=%s diff=%s", scenario, receiverBalanceBefore, receiverAfter, receiverAfter.subtract(receiverBalanceBefore)));
    }


    private void assertNoCompletedTransactionRow(String scenario) throws Exception {
        long completedCount = transfers.countByStatus("COMPLETED");

        assertEquals(0, completedCount, String.format("[%s] Found %d COMPLETED transaction row(s) — " + "a rejected transfer must never be marked COMPLETED.", scenario, completedCount));


        long failedCount = transfers.countByStatus("FAILED");

        if (failedCount > 1) {
            fail(String.format("[%s] Found %d FAILED transaction rows — expected at most 1.", scenario, failedCount));
        }
    }


    private void assertNoOutboxEvent(String scenario) throws Exception {
        long count = transfers.countOutboxEventsRecent();

        assertEquals(0, count, String.format("[%s] Found %d outbox_events row(s) — " + "rejected transfers must not publish domain events.", scenario, count));
    }


    private void assertFailureAuditEventIfPresent(String scenario) throws Exception {
        List<Map<String, Object>> rows = db.query("SELECT * FROM audit_events WHERE resource_type = 'TRANSFER' " + "AND occurred_at > NOW() - INTERVAL '5 minutes'");

        if (rows.isEmpty()) {
            return;
        }

        assertEquals(1, rows.size(), String.format("[%s] At most one audit row expected per transfer attempt, found %d", scenario, rows.size()));

        Map<String, Object> event = rows.get(0);
        String eventType = ((String) event.get("event_type")).toUpperCase();

        assertTrue(eventType.contains("FAILED") || eventType.contains("REJECTED"), String.format("[%s] Audit event_type for a failed transfer must contain " + "FAILED or REJECTED. actual='%s'", scenario, eventType));

        assertNotNull(event.get("resource_id"), String.format("[%s] audit_events.resource_id must not be null", scenario));
        assertNotNull(event.get("occurred_at"), String.format("[%s] audit_events.occurred_at must not be null", scenario));


        String details = (String) event.get("details");
        if (details != null && !details.isBlank()) {
            assertTrue(details.toLowerCase().contains("insufficient") || details.toLowerCase().contains("balance") || details.toLowerCase().contains("funds"), String.format("[%s] Audit event details should describe the failure reason. " + "actual='%s'", scenario, details));
        }
    }

}
