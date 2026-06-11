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
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

@Tag("concurrency")
@Testcontainers
@DisplayName("Wallet Transfer — Concurrency")
class WalletTransferConcurrencyTest {


    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(TestConfig.DB_IMAGE).withDatabaseName(TestConfig.DB_NAME).withUsername(TestConfig.DB_USER).withPassword(TestConfig.DB_PASS);
    private static final BigDecimal WALLET_BALANCE = new BigDecimal("1000.00");
    private static final BigDecimal TRANSFER_A_AMOUNT = new BigDecimal("800.00");
    private static final BigDecimal TRANSFER_B_AMOUNT = new BigDecimal("800.00");
    private static final int CONCURRENT_REQUESTS = 10;
    private static final BigDecimal IDEMPOTENT_AMOUNT = WalletFixtures.SMALL_TRANSFER;
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

        Wallet sender = WalletBuilder.anAlphaWallet().withOwnerId("owner-alpha").withBalance(WALLET_BALANCE).build();
        Wallet receiver = WalletBuilder.aBetaWallet().withOwnerId("owner-beta").withBalance(WalletFixtures.DEFAULT_BALANCE).build();
        DatabaseSeeder.seedWallets(db, sender, receiver);

        senderBalanceBefore = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        receiverBalanceBefore = wallets.balanceOf(WalletFixtures.WALLET_BETA);
    }

    @AfterEach
    void tearDown() throws Exception {
        db.close();
    }


    @Test
    @DisplayName("Scenario 1 — Competing transfers: exactly one wins, no overdraft")
    void scenario1_competingTransfers_exactlyOneSucceeds() throws Exception {
        TransferRequest requestA = TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_A_AMOUNT).withKey(IdempotencyKeyGenerator.sequential("compete-A")).build();

        TransferRequest requestB = TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_B_AMOUNT).withKey(IdempotencyKeyGenerator.sequential("compete-B")).build();


        List<TransferResponse> responses = fireSimultaneously(requestA, requestB);

        TransferResponse responseA = responses.get(0);
        TransferResponse responseB = responses.get(1);


        assertTrue(responseA.getStatusCode() < 500, "Transfer A must not return 5xx — got " + responseA.getStatusCode());
        assertTrue(responseB.getStatusCode() < 500, "Transfer B must not return 5xx — got " + responseB.getStatusCode());


        long successCount = responses.stream().filter(r -> r.getStatusCode() == 200).count();
        long rejectedCount = responses.stream().filter(r -> r.getStatusCode() == 422).count();

        assertEquals(1, successCount, "Exactly one competing transfer must succeed. " + "A/B statuses: " + responseA.getStatusCode() + " / " + responseB.getStatusCode() + ". Two successes = overdraft; zero successes = incorrect rejection.");

        assertEquals(1, rejectedCount, "The losing transfer must be rejected with 422 Insufficient Funds. " + "A/B statuses: " + responseA.getStatusCode() + " / " + responseB.getStatusCode());


        BigDecimal senderFinal = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        assertTrue(senderFinal.compareTo(BigDecimal.ZERO) >= 0, "Sender balance must never go negative (overdraft). actual=" + senderFinal);


        BigDecimal winningAmount = (responseA.getStatusCode() == 200) ? TRANSFER_A_AMOUNT : TRANSFER_B_AMOUNT;
        BigDecimal expectedSenderBalance = senderBalanceBefore.subtract(winningAmount);

        assertEquals(0, expectedSenderBalance.compareTo(senderFinal), "Sender balance must reflect exactly one debit of the winning amount. " + "before=" + senderBalanceBefore + " winAmount=" + winningAmount + " expected=" + expectedSenderBalance + " actual=" + senderFinal);


        BigDecimal receiverFinal = wallets.balanceOf(WalletFixtures.WALLET_BETA);
        BigDecimal expectedReceiver = receiverBalanceBefore.add(winningAmount);

        assertEquals(0, expectedReceiver.compareTo(receiverFinal), "Receiver balance must reflect exactly one credit of the winning amount. " + "expected=" + expectedReceiver + " actual=" + receiverFinal);


        BigDecimal totalBefore = senderBalanceBefore.add(receiverBalanceBefore);
        BigDecimal totalAfter = wallets.balanceOf(WalletFixtures.WALLET_ALPHA).add(wallets.balanceOf(WalletFixtures.WALLET_BETA));

        assertEquals(0, totalBefore.compareTo(totalAfter), "Total balance must be conserved. before=" + totalBefore + " after=" + totalAfter + " diff=" + totalAfter.subtract(totalBefore));


        long completedRows = transfers.countCompleted();

        assertEquals(1, completedRows, "Exactly one COMPLETED transaction row must exist. found=" + completedRows);
    }


    @Test
    @DisplayName("Scenario 2 — 10 concurrent same-key requests: exactly-once side effects")
    void scenario2_concurrentSameKey_exactlyOnceSemantics() throws Exception {
        String sharedKey = IdempotencyKeyGenerator.sequential("idempotent-storm");
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withAmount(IDEMPOTENT_AMOUNT).withKey(sharedKey).build();


        List<TransferResponse> responses = fireSimultaneously(buildRequestList(request, CONCURRENT_REQUESTS));


        responses.forEach(r -> assertTrue(r.getStatusCode() < 500, "No concurrent request must return 5xx — got " + r.getStatusCode()));


        List<TransferResponse> successes = responses.stream().filter(r -> r.getStatusCode() == 200).toList();

        assertFalse(successes.isEmpty(), "At least one of the " + CONCURRENT_REQUESTS + " concurrent requests must return 200");


        long distinctTxIds = successes.stream().map(TransferResponse::getTransactionId).distinct().count();

        assertEquals(1, distinctTxIds, "All 200 responses must carry the same transactionId. " + "Distinct IDs found: " + distinctTxIds + " — each unique ID represents a separate (duplicate) debit.");

        String canonicalTxId = successes.get(0).getTransactionId();


        long completedTxRows = transfers.countCompleted();

        assertEquals(1, completedTxRows, "Exactly one COMPLETED transactions row must exist. " + "found=" + completedTxRows + " — each extra row is a duplicate debit committed to the DB.");


        BigDecimal senderFinal = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        BigDecimal expectedSender = senderBalanceBefore.subtract(IDEMPOTENT_AMOUNT);

        assertEquals(0, expectedSender.compareTo(senderFinal), "Sender must be debited exactly once across all concurrent requests. " + "before=" + senderBalanceBefore + " expected=" + expectedSender + " actual=" + senderFinal + " — a larger deduction means multiple debits were committed.");


        BigDecimal receiverFinal = wallets.balanceOf(WalletFixtures.WALLET_BETA);
        BigDecimal expectedReceiver = receiverBalanceBefore.add(IDEMPOTENT_AMOUNT);

        assertEquals(0, expectedReceiver.compareTo(receiverFinal), "Receiver must be credited exactly once across all concurrent requests. " + "before=" + receiverBalanceBefore + " expected=" + expectedReceiver + " actual=" + receiverFinal);


        long auditRows = transfers.countAuditEventsFor(canonicalTxId);

        assertEquals(1, auditRows, "Exactly one audit_events row must exist for this transfer. " + "found=" + auditRows + " — multiple rows indicate the transfer was audited N times.");


        long outboxRows = transfers.countOutboxEventsFor(canonicalTxId);

        assertEquals(1, outboxRows, "Exactly one outbox_events row must exist for this transfer. " + "found=" + outboxRows + " — multiple rows would cause consumers to process the event N times.");


        Map<String, Object> outboxRow = transfers.outboxEventFor(canonicalTxId).orElseThrow();

        assertEquals("TRANSFER_COMPLETED", ((String) outboxRow.get("event_type")).toUpperCase(), "outbox event_type must be TRANSFER_COMPLETED");

        assertNull(outboxRow.get("published_at"), "outbox published_at must be null — relay has not run yet");


        BigDecimal totalBefore = senderBalanceBefore.add(receiverBalanceBefore);
        BigDecimal totalAfter = senderFinal.add(receiverFinal);

        assertEquals(0, totalBefore.compareTo(totalAfter), "Total balance must be conserved across all concurrent requests. " + "before=" + totalBefore + " after=" + totalAfter);
    }


    private List<TransferResponse> fireSimultaneously(TransferRequest first, TransferRequest second) throws Exception {
        return fireSimultaneously(List.of(first, second));
    }


    private List<TransferResponse> fireSimultaneously(List<TransferRequest> requests) throws Exception {

        int n = requests.size();
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch allDone = new CountDownLatch(n);
        ExecutorService pool = Executors.newFixedThreadPool(n);

        @SuppressWarnings("unchecked") Future<TransferResponse>[] futures = new Future[n];

        for (int i = 0; i < n; i++) {
            final TransferRequest req = requests.get(i);
            futures[i] = pool.submit(() -> {
                try {
                    startGate.await();
                    return client.createTransfer(req);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException("Thread interrupted before start gate", e);
                } finally {
                    allDone.countDown();
                }
            });
        }


        startGate.countDown();

        boolean completed = allDone.await(30, TimeUnit.SECONDS);
        pool.shutdown();

        assertTrue(completed, "Not all concurrent requests finished within 30 seconds — " + "possible deadlock or service hang");

        List<TransferResponse> responses = new ArrayList<>(n);
        for (Future<TransferResponse> f : futures) {
            responses.add(f.get());
        }
        return responses;
    }


    private List<TransferRequest> buildRequestList(TransferRequest request, int count) {
        List<TransferRequest> list = new ArrayList<>(count);
        for (int i = 0; i < count; i++) list.add(request);
        return list;
    }
}

