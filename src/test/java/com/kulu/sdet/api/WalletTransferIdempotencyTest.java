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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

@Tag("idempotency")
@Testcontainers
@DisplayName("Wallet Transfer — Idempotency")
class WalletTransferIdempotencyTest {


    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(TestConfig.DB_IMAGE).withDatabaseName(TestConfig.DB_NAME).withUsername(TestConfig.DB_USER).withPassword(TestConfig.DB_PASS);
    private static final BigDecimal SENDER_BALANCE = WalletFixtures.DEFAULT_BALANCE;
    private static final BigDecimal RECEIVER_BALANCE = WalletFixtures.DEFAULT_BALANCE;
    private static final BigDecimal TRANSFER_AMOUNT = WalletFixtures.SMALL_TRANSFER;
    private WalletTransferClient client;
    private DbClient db;
    private WalletRepository wallets;
    private TransferRepository transfers;
    private BigDecimal senderBalanceBefore;
    private BigDecimal receiverBalanceBefore;


    @BeforeEach
    void setUp() throws Exception {
        db = new DbClient(POSTGRES);
        client = new WalletTransferClient();
        wallets = new WalletRepository(db);
        transfers = new TransferRepository(db);

        DatabaseSeeder.applySchema(db);

        Wallet sender = WalletBuilder.anAlphaWallet().withOwnerId("owner-alpha").withBalance(SENDER_BALANCE).build();
        Wallet receiver = WalletBuilder.aBetaWallet().withOwnerId("owner-beta").withBalance(RECEIVER_BALANCE).build();
        DatabaseSeeder.seedWallets(db, sender, receiver);

        senderBalanceBefore = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        receiverBalanceBefore = wallets.balanceOf(WalletFixtures.WALLET_BETA);
    }

    @AfterEach
    void tearDown() throws Exception {
        db.close();
    }


    @Test
    @DisplayName("Scenario 1 — Same key + same payload: original result returned, debited once")
    void scenario1_sameKeyAndPayload_exactlyOnceSemantics() throws Exception {
        String key = IdempotencyKeyGenerator.forTest("scenario1_safe_replay");
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_AMOUNT).withKey(key).build();


        TransferResponse first = client.createTransfer(request);

        assertEquals(200, first.getStatusCode(), "First call must succeed with 200");
        assertNotNull(first.getTransactionId(), "First call must return a transactionId");
        assertEquals("COMPLETED", first.getStatus());


        TransferResponse second = client.createTransfer(request);

        assertEquals(200, second.getStatusCode(), "Replay must return 200 — not 4xx or 5xx");
        assertEquals(first.getTransactionId(), second.getTransactionId(), "Replay must return the SAME transactionId as the original call");
        assertEquals("COMPLETED", second.getStatus(), "Replayed status must match the original status");


        TransferResponse third = client.createTransfer(request);

        assertEquals(first.getTransactionId(), third.getTransactionId(), "Second replay must still return the original transactionId");


        assertExactlyOnceDebit("Scenario 1");
        assertExactlyOnceCredit("Scenario 1");


        assertExactlyOneTransactionRow("Scenario 1", first.getTransactionId());
        assertExactlyOneOutboxEvent("Scenario 1", first.getTransactionId());
    }


    @Test
    @DisplayName("Scenario 2 — Same key + different payload: 409 Conflict, no second transfer")
    void scenario2_sameKeyDifferentPayload_conflictRejected() throws Exception {
        String key = IdempotencyKeyGenerator.forTest("scenario2_payload_conflict");


        TransferRequest originalRequest = TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_AMOUNT).withKey(key).build();

        TransferResponse original = client.createTransfer(originalRequest);
        assertEquals(200, original.getStatusCode(), "Original transfer must succeed");


        BigDecimal senderAfterFirst = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        BigDecimal receiverAfterFirst = wallets.balanceOf(WalletFixtures.WALLET_BETA);


        TransferRequest conflictRequest = TransferRequestBuilder.aValidTransfer().withAmount(WalletFixtures.LARGE_TRANSFER).withKey(key).build();

        TransferResponse conflict = client.createTransfer(conflictRequest);


        assertEquals(409, conflict.getStatusCode(), "Conflicting payload on an existing key must return 409 Conflict");
        assertNotNull(conflict.getErrorMessage(), "409 response must include an error message");


        long txCount = transfers.countAll();
        assertEquals(1, txCount, "Exactly one transactions row must exist — the conflict must not create a second");


        BigDecimal senderAfterConflict = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        BigDecimal receiverAfterConflict = wallets.balanceOf(WalletFixtures.WALLET_BETA);

        assertEquals(0, senderAfterFirst.compareTo(senderAfterConflict), "Sender balance must not change after a 409 conflict. " + "before=" + senderAfterFirst + " after=" + senderAfterConflict);
        assertEquals(0, receiverAfterFirst.compareTo(receiverAfterConflict), "Receiver balance must not change after a 409 conflict. " + "before=" + receiverAfterFirst + " after=" + receiverAfterConflict);


        long outboxCount = transfers.countOutboxEventsRecent();
        assertEquals(1, outboxCount, "Only the original outbox event must exist — the conflict must not add another");
    }


    @Test
    @DisplayName("Scenario 3 — Concurrent retries: exactly-once semantics under race conditions")
    void scenario3_concurrentRetries_exactlyOnceSemantics() throws Exception {
        final int RETRY_COUNT = 6;
        String key = IdempotencyKeyGenerator.sequential("concurrent-retry");
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_AMOUNT).withKey(key).build();


        ExecutorService pool = Executors.newFixedThreadPool(RETRY_COUNT);
        List<Future<TransferResponse>> futures = new ArrayList<>();

        for (int i = 0; i < RETRY_COUNT; i++) {
            futures.add(pool.submit(() -> client.createTransfer(request)));
        }
        pool.shutdown();
        boolean finished = pool.awaitTermination(30, TimeUnit.SECONDS);
        assertTrue(finished, "Thread pool did not finish within 30 seconds");


        List<TransferResponse> responses = new ArrayList<>();
        for (Future<TransferResponse> f : futures) {
            responses.add(f.get());
        }


        responses.forEach(r -> assertTrue(r.getStatusCode() < 500, "No concurrent retry should produce a 5xx. Got: " + r.getStatusCode()));


        List<String> successfulTxIds = responses.stream().filter(r -> r.getStatusCode() == 200).map(TransferResponse::getTransactionId).toList();

        assertFalse(successfulTxIds.isEmpty(), "At least one concurrent request must succeed");

        long distinctTxIds = successfulTxIds.stream().distinct().count();
        assertEquals(1, distinctTxIds, "All 200 responses must share a single transactionId — " + "distinct IDs found: " + successfulTxIds);

        String canonicalTxId = successfulTxIds.get(0);


        assertExactlyOnceDebit("Scenario 3 (concurrent)");
        assertExactlyOnceCredit("Scenario 3 (concurrent)");


        assertExactlyOneTransactionRow("Scenario 3 (concurrent)", canonicalTxId);
        assertExactlyOneOutboxEvent("Scenario 3 (concurrent)", canonicalTxId);


        BigDecimal totalBefore = senderBalanceBefore.add(receiverBalanceBefore);
        BigDecimal totalAfter = wallets.totalBalance();
        assertEquals(0, totalBefore.compareTo(totalAfter), "Total balance must be conserved. before=" + totalBefore + " after=" + totalAfter);
    }


    private void assertExactlyOnceDebit(String scenario) throws Exception {
        BigDecimal senderAfter = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        BigDecimal expectedSender = senderBalanceBefore.subtract(TRANSFER_AMOUNT);

        assertEquals(0, expectedSender.compareTo(senderAfter), String.format("[%s] Sender debited incorrectly — expected %s but got %s. " + "A larger deduction indicates a double-debit.", scenario, expectedSender, senderAfter));
    }


    private void assertExactlyOnceCredit(String scenario) throws Exception {
        BigDecimal receiverAfter = wallets.balanceOf(WalletFixtures.WALLET_BETA);
        BigDecimal expectedReceiver = receiverBalanceBefore.add(TRANSFER_AMOUNT);

        assertEquals(0, expectedReceiver.compareTo(receiverAfter), String.format("[%s] Receiver credited incorrectly — expected %s but got %s. " + "A larger credit indicates a double-credit.", scenario, expectedReceiver, receiverAfter));
    }


    private void assertExactlyOneTransactionRow(String scenario, String transactionId) throws Exception {
        long count = transfers.countRowsForTransactionId(transactionId);

        assertEquals(1, count, String.format("[%s] Expected exactly 1 transactions row for id=%s but found %d. " + "Multiple rows indicate idempotency is not enforced at the DB layer.", scenario, transactionId, count));


        long totalCount = transfers.countAll();

        assertEquals(1, totalCount, String.format("[%s] Expected exactly 1 total transactions row in this window " + "but found %d. Each replay must not insert a new row.", scenario, totalCount));
    }


    private void assertExactlyOneOutboxEvent(String scenario, String transactionId) throws Exception {
        long count = transfers.countOutboxEventsFor(transactionId);

        assertEquals(1, count, String.format("[%s] Expected exactly 1 outbox_events row for aggregate_id=%s " + "but found %d. Multiple rows would cause duplicate downstream events.", scenario, transactionId, count));


        Map<String, Object> row = transfers.outboxEventFor(transactionId).orElseThrow();

        String eventType = ((String) row.get("event_type")).toUpperCase();
        assertEquals("TRANSFER_COMPLETED", eventType, String.format("[%s] outbox event_type must be TRANSFER_COMPLETED, got '%s'", scenario, eventType));

        assertNull(row.get("published_at"), String.format("[%s] outbox published_at must be null — relay has not run yet", scenario));
    }

}

