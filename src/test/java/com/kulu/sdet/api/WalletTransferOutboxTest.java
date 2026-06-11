package com.kulu.sdet.api;

import com.kulu.sdet.fixtures.IdempotencyKeyGenerator;
import com.kulu.sdet.fixtures.TransferRequestBuilder;
import com.kulu.sdet.fixtures.WalletBuilder;
import com.kulu.sdet.fixtures.WalletFixtures;
import com.kulu.sdet.model.TransferRequest;
import com.kulu.sdet.model.TransferResponse;
import com.kulu.sdet.support.*;
import org.junit.jupiter.api.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@Tag("outbox")
@Testcontainers
@DisplayName("Wallet Transfer — Outbox & Audit Consistency")
class WalletTransferOutboxTest {


    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(TestConfig.DB_IMAGE).withDatabaseName(TestConfig.DB_NAME).withUsername(TestConfig.DB_USER).withPassword(TestConfig.DB_PASS);
    private static final BigDecimal TRANSFER_AMOUNT = new BigDecimal("50.00");
    private WalletTransferClient client;
    private WalletRepository wallets;
    private TransferRepository transfers;
    private DbClient db;

    @BeforeEach
    void setUp() throws Exception {
        db = new DbClient(POSTGRES);
        wallets = new WalletRepository(db);
        transfers = new TransferRepository(db);
        client = new WalletTransferClient();

        DatabaseSeeder.applySchema(db);
        DatabaseSeeder.seedWallets(db, WalletBuilder.anAlphaWallet().withOwnerId("owner-alpha").build(), WalletBuilder.aBetaWallet().withOwnerId("owner-beta").build());
    }

    @AfterEach
    void tearDown() throws Exception {
        db.close();
    }


    @Test
    @DisplayName("Successful transfer creates exactly one outbox event awaiting relay")
    void transfer_success_createsExactlyOneOutboxEvent() throws Exception {
        TransferResponse response = client.createTransfer(TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_AMOUNT).withKey(IdempotencyKeyGenerator.random()).build());

        assertEquals(200, response.getStatusCode(), "Transfer must succeed");
        String txId = response.getTransactionId();


        assertEquals(1, transfers.countOutboxEventsFor(txId), "Exactly one outbox_events row must exist. " + "Zero = downstream consumers are deaf. Multiple = phantom duplicate events.");


        Map<String, Object> outbox = transfers.outboxEventFor(txId).orElseThrow(() -> new AssertionError("outbox_events row not found for aggregate_id=" + txId));

        assertEquals("TRANSFER_COMPLETED", ((String) outbox.get("event_type")).toUpperCase(), "outbox event_type must be TRANSFER_COMPLETED");

        assertEquals(txId, outbox.get("aggregate_id"), "outbox aggregate_id must match the transaction ID");


        assertTrue(transfers.isAwaitingRelay(txId), "outbox published_at must be null — " + "the row must wait for the relay process to pick it up");

        assertNotNull(outbox.get("created_at"), "outbox created_at must be set by the service");
    }


    @Test
    @DisplayName("Outbox event payload references correct transfer details")
    void transfer_success_outboxPayloadReferencesCorrectTransfer() throws Exception {
        String key = IdempotencyKeyGenerator.random();
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_AMOUNT).withKey(key).build();

        TransferResponse response = client.createTransfer(request);
        assertEquals(200, response.getStatusCode(), "Transfer must succeed");
        String txId = response.getTransactionId();

        Map<String, Object> outbox = transfers.outboxEventFor(txId).orElseThrow(() -> new AssertionError("outbox row not found for txId=" + txId));

        String payload = (String) outbox.get("payload");


        assertNotNull(payload, "outbox payload must not be null");
        assertFalse(payload.isBlank(), "outbox payload must not be blank");


        assertTrue(payload.contains(txId), "outbox payload must reference the transactionId. " + "txId=" + txId + " payload=" + payload);


        assertTrue(payload.contains(WalletFixtures.WALLET_ALPHA), "outbox payload must include fromWalletId=" + WalletFixtures.WALLET_ALPHA);
        assertTrue(payload.contains(WalletFixtures.WALLET_BETA), "outbox payload must include toWalletId=" + WalletFixtures.WALLET_BETA);


        assertTrue(payload.contains(TRANSFER_AMOUNT.toPlainString()), "outbox payload must include the transfer amount=" + TRANSFER_AMOUNT.toPlainString() + " payload=" + payload);


        assertTrue(payload.toUpperCase().contains("USD"), "outbox payload must reference currency USD. payload=" + payload);


        Map<String, Object> tx = transfers.findById(txId).orElseThrow(() -> new AssertionError("transactions row not found for id=" + txId));

        assertEquals(outbox.get("aggregate_id"), tx.get("id"), "outbox aggregate_id must equal transactions.id");
        assertEquals("COMPLETED", ((String) tx.get("status")).toUpperCase(), "transactions.status must be COMPLETED when outbox row is written");
    }


    @Test
    @DisplayName("Idempotent replay does not create duplicate outbox events")
    void transfer_idempotentReplay_exactlyOneOutboxEvent() throws Exception {
        String key = IdempotencyKeyGenerator.forTest("outbox_idempotency_replay");
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_AMOUNT).withKey(key).build();


        TransferResponse first = client.createTransfer(request);
        assertEquals(200, first.getStatusCode(), "First call must succeed");
        String txId = first.getTransactionId();


        TransferResponse second = client.createTransfer(request);
        assertEquals(200, second.getStatusCode(), "Replay must return 200");
        assertEquals(txId, second.getTransactionId(), "Replay must return the same transactionId");


        TransferResponse third = client.createTransfer(request);
        assertEquals(txId, third.getTransactionId(), "Second replay must still return the original transactionId");


        long outboxCount = transfers.countOutboxEventsFor(txId);
        assertEquals(1, outboxCount, "Replaying the same key " + 3 + " times must produce exactly 1 outbox row. " + "found=" + outboxCount + " — each extra row will trigger a duplicate event to every downstream consumer.");


        assertTrue(transfers.isAwaitingRelay(txId), "outbox row must remain unpublished — relay has not run");


        assertEquals(1, transfers.countRowsForTransactionId(txId), "Replaying the same key must not create duplicate transactions rows");


        BigDecimal senderBalance = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        assertNotNull(senderBalance);
        BigDecimal initialBalance = WalletFixtures.DEFAULT_BALANCE;
        BigDecimal expectedBalance = initialBalance.subtract(TRANSFER_AMOUNT);
        assertEquals(0, expectedBalance.compareTo(senderBalance), "Sender must be debited exactly once despite 3 replays. " + "expected=" + expectedBalance + " actual=" + senderBalance + " — a larger deduction means multiple debits were committed.");
    }


    @Test
    @DisplayName("Audit records are internally consistent with transaction and outbox rows")
    void transfer_success_auditAndOutboxAreConsistent() throws Exception {
        String key = IdempotencyKeyGenerator.random();
        TransferResponse response = client.createTransfer(TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_AMOUNT).withKey(key).build());

        assertEquals(200, response.getStatusCode(), "Transfer must succeed");
        String txId = response.getTransactionId();


        long auditCount = transfers.countAuditEventsFor(txId);
        assertEquals(1, auditCount, "Exactly one audit_events row must exist for a completed transfer. " + "found=" + auditCount);


        List<Map<String, Object>> auditRows = transfers.findAuditEventsFor(txId);
        Map<String, Object> audit = auditRows.get(0);

        assertNotNull(audit.get("id"), "audit_events.id must be set");
        assertEquals("TRANSFER_COMPLETED", ((String) audit.get("event_type")).toUpperCase(), "audit event_type must be TRANSFER_COMPLETED for a successful transfer");
        assertEquals(txId, audit.get("resource_id"), "audit resource_id must reference the transactionId");
        assertEquals("TRANSFER", ((String) audit.get("resource_type")).toUpperCase(), "audit resource_type must be TRANSFER");
        assertNotNull(audit.get("occurred_at"), "audit occurred_at must be set");


        long outboxCount = transfers.countOutboxEventsFor(txId);
        assertEquals(auditCount, outboxCount, "Audit row count and outbox row count must both equal 1. " + "audit=" + auditCount + " outbox=" + outboxCount + " — mismatch indicates partial write or split-brain between the two tables.");


        Map<String, Object> outbox = transfers.outboxEventFor(txId).orElseThrow();
        Map<String, Object> tx = transfers.findById(txId).orElseThrow();

        assertEquals(outbox.get("aggregate_id"), tx.get("id"), "outbox aggregate_id must equal transactions.id");
        assertEquals("COMPLETED", ((String) tx.get("status")).toUpperCase(), "transaction must be COMPLETED when audit and outbox rows are present");


        assertEquals(((String) audit.get("event_type")).toUpperCase(), ((String) outbox.get("event_type")).toUpperCase(), "audit and outbox event_type must agree — " + "mismatched types indicate inconsistent writes across tables.");
    }


    @Test
    @DisplayName("Rejected transfer (insufficient funds) produces no outbox event")
    void transfer_rejected_noOutboxEvent() throws Exception {
        TransferResponse response = client.createTransfer(TransferRequestBuilder.withInsufficientFunds().withKey(IdempotencyKeyGenerator.random()).build());

        assertEquals(422, response.getStatusCode(), "Transfer must be rejected with 422 Insufficient Funds");


        long outboxCount = transfers.countOutboxEventsRecent();
        assertEquals(0, outboxCount, "Rejected transfer must not produce any outbox rows. " + "found=" + outboxCount + " — a phantom outbox row would cause consumers to process a transfer that never happened.");


        long completedCount = transfers.countCompleted();
        assertEquals(0, completedCount, "Rejected transfer must not produce a COMPLETED transactions row. " + "found=" + completedCount);


        BigDecimal senderBalance = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        BigDecimal receiverBalance = wallets.balanceOf(WalletFixtures.WALLET_BETA);
        assertNotNull(senderBalance);
        assertNotNull(receiverBalance);

        assertEquals(0, WalletFixtures.DEFAULT_BALANCE.compareTo(senderBalance), "Sender balance must be unchanged after rejection. " + "expected=" + WalletFixtures.DEFAULT_BALANCE + " actual=" + senderBalance);
        assertEquals(0, WalletFixtures.DEFAULT_BALANCE.compareTo(receiverBalance), "Receiver balance must be unchanged after rejection. " + "expected=" + WalletFixtures.DEFAULT_BALANCE + " actual=" + receiverBalance);
    }
}
