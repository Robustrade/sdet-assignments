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
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@Tag("happy-path")
@Testcontainers
@DisplayName("Wallet Transfer — Happy Path")
class WalletTransferHappyPathTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(TestConfig.DB_IMAGE).withDatabaseName(TestConfig.DB_NAME).withUsername(TestConfig.DB_USER).withPassword(TestConfig.DB_PASS);
    private static final BigDecimal TRANSFER_AMOUNT = new BigDecimal("75.00");
    private WalletTransferClient client;
    private WalletRepository wallets;
    private TransferRepository transfers;
    private DbClient db;
    private BigDecimal senderBalanceBefore;
    private BigDecimal receiverBalanceBefore;

    @BeforeEach
    void setUp() throws Exception {
        db = new DbClient(POSTGRES);
        wallets = new WalletRepository(db);
        transfers = new TransferRepository(db);
        client = new WalletTransferClient();

        DatabaseSeeder.applySchema(db);
        DatabaseSeeder.seedWallets(db, WalletBuilder.anAlphaWallet().withOwnerId("owner-alpha").build(), WalletBuilder.aBetaWallet().withOwnerId("owner-beta").build());

        senderBalanceBefore = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        receiverBalanceBefore = wallets.balanceOf(WalletFixtures.WALLET_BETA);
    }

    @AfterEach
    void tearDown() throws Exception {
        db.close();
    }

    @Test
    @DisplayName("A valid transfer satisfies all business invariants end-to-end")
    void transfer_happyPath_allInvariantsHold() throws Exception {
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withAmount(TRANSFER_AMOUNT).withKey(IdempotencyKeyGenerator.random()).build();

        TransferResponse response = client.createTransfer(request);

        assertHttpResponse(response, request);
        assertSenderDebited(response.getTransactionId());
        assertReceiverCredited(response.getTransactionId());
        assertBalanceConservation();
        assertTransactionRowPersisted(response);
        assertAuditEventPersisted(response.getTransactionId());
        assertOutboxEventPersisted(response.getTransactionId());
    }

    private void assertHttpResponse(TransferResponse response, TransferRequest request) {
        assertEquals(200, response.getStatusCode(), "Transfer must return HTTP 200 OK");
        assertNotNull(response.getTransactionId(), "Response must contain a non-null transactionId");
        assertFalse(response.getTransactionId().isBlank(), "transactionId must not be blank");
        assertEquals("COMPLETED", response.getStatus(), "Transfer status must be COMPLETED");
        assertEquals(request.getFromWalletId(), response.getFromWalletId(), "fromWalletId must echo request");
        assertEquals(request.getToWalletId(), response.getToWalletId(), "toWalletId must echo request");
        assertNotNull(response.getAmount(), "Response must include the transfer amount");
        assertEquals(0, TRANSFER_AMOUNT.compareTo(response.getAmount()), "Response amount must equal requested amount");
        assertNotNull(response.getCurrency(), "Response must include currency");
    }

    private void assertSenderDebited(String txId) throws Exception {
        BigDecimal after = wallets.balanceOf(WalletFixtures.WALLET_ALPHA);
        BigDecimal expected = senderBalanceBefore.subtract(TRANSFER_AMOUNT);
        assertEquals(0, expected.compareTo(after), "Sender debited incorrectly [txId=" + txId + "] expected=" + expected + " actual=" + after);
    }

    private void assertReceiverCredited(String txId) throws Exception {
        BigDecimal after = wallets.balanceOf(WalletFixtures.WALLET_BETA);
        BigDecimal expected = receiverBalanceBefore.add(TRANSFER_AMOUNT);
        assertEquals(0, expected.compareTo(after), "Receiver credited incorrectly [txId=" + txId + "] expected=" + expected + " actual=" + after);
    }

    private void assertBalanceConservation() throws Exception {
        BigDecimal totalBefore = senderBalanceBefore.add(receiverBalanceBefore);
        BigDecimal totalAfter = wallets.totalBalance();
        assertEquals(0, totalBefore.compareTo(totalAfter), "Balance conservation violated. before=" + totalBefore + " after=" + totalAfter);
    }

    private void assertTransactionRowPersisted(TransferResponse response) throws Exception {
        assertEquals(1, transfers.countRowsForTransactionId(response.getTransactionId()), "Exactly one transactions row must exist");

        Map<String, Object> tx = transfers.findById(response.getTransactionId()).orElseThrow();
        assertEquals(WalletFixtures.WALLET_ALPHA, tx.get("from_wallet_id"), "from_wallet_id mismatch");
        assertEquals(WalletFixtures.WALLET_BETA, tx.get("to_wallet_id"), "to_wallet_id mismatch");
        assertEquals(0, TRANSFER_AMOUNT.compareTo((BigDecimal) tx.get("amount")), "amount mismatch");
        assertEquals("USD", ((String) tx.get("currency")).toUpperCase(), "currency must be USD");
        assertEquals("COMPLETED", ((String) tx.get("status")).toUpperCase(), "status must be COMPLETED");
        assertNotNull(tx.get("created_at"), "created_at must be set");
    }

    private void assertAuditEventPersisted(String txId) throws Exception {
        assertEquals(1, transfers.countAuditEventsFor(txId), "Exactly one audit_events row must exist");

        Map<String, Object> event = transfers.findAuditEventsFor(txId).get(0);
        assertEquals("TRANSFER_COMPLETED", ((String) event.get("event_type")).toUpperCase(), "audit event_type must be TRANSFER_COMPLETED");
        assertNotNull(event.get("occurred_at"), "audit occurred_at must be set");
    }

    private void assertOutboxEventPersisted(String txId) throws Exception {
        assertEquals(1, transfers.countOutboxEventsFor(txId), "Exactly one outbox_events row must exist");

        Map<String, Object> outbox = transfers.outboxEventFor(txId).orElseThrow();
        assertEquals("TRANSFER_COMPLETED", ((String) outbox.get("event_type")).toUpperCase(), "outbox event_type must be TRANSFER_COMPLETED");
        String payload = (String) outbox.get("payload");
        assertNotNull(payload, "outbox payload must not be null");
        assertFalse(payload.isBlank(), "outbox payload must not be blank");
        assertTrue(payload.contains(WalletFixtures.WALLET_ALPHA), "payload must include fromWalletId");
        assertTrue(payload.contains(WalletFixtures.WALLET_BETA), "payload must include toWalletId");
        assertTrue(transfers.isAwaitingRelay(txId), "outbox published_at must be null");
    }
}
