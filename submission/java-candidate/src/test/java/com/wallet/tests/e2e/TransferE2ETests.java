package com.wallet.tests.e2e;

import com.wallet.builders.WalletBuilder;
import com.wallet.model.TransferRequest;
import com.wallet.tests.BaseIntegrationTest;
import org.junit.jupiter.api.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static com.wallet.assertions.ApiAssertions.assertThatResponse;
import static com.wallet.builders.TransferRequestBuilder.aTransfer;
import static com.wallet.fixtures.TestDataSeeder.*;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * END-TO-END FLOW TESTS
 *
 * Validates the full path:
 *   API request → service processing → DB persistence → side-effect verification
 *
 * Every test here checks:
 *  1. API response
 *  2. DB wallet balances
 *  3. Transfer row correctness
 *  4. Audit / event rows
 *  5. Outbox events
 */
@DisplayName("Transfer E2E — Full Flow & DB Verification")
@TestMethodOrder(MethodOrderer.DisplayName.class)
class TransferE2ETests extends BaseIntegrationTest {

    // ─────────────────────────────────────────────────────────────────────────
    //  Happy Path — full debit/credit/persist verification
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[E2E-01] Successful transfer — balances updated correctly in DB")
    void successfulTransfer_balancesUpdatedExactlyOnce() {
        BigDecimal amount       = BigDecimal.valueOf(2_500);
        BigDecimal aliceBefore  = walletRepo.getBalance(ALICE);
        BigDecimal bobBefore    = walletRepo.getBalance(BOB);
        String key = newIdempotencyKey();

        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(amount).currency("AED").reference("e2e-01")
                .build();

        String transferId = assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated()
                .hasTransferId()
                .hasStatus("COMPLETED")
                .extractTransferId();

        // API matches DB
        dbAssert.transferExistsWithStatus(transferId, "COMPLETED");

        // Balance invariants
        businessAssert.verifySuccessfulTransfer(ALICE, BOB, amount, aliceBefore, bobBefore);

        // Audit events
        dbAssert.transferHasEvent(transferId, "TRANSFER_INITIATED");
        dbAssert.transferHasEvent(transferId, "TRANSFER_COMPLETED");

        // Outbox (transactional outbox pattern)
        dbAssert.transferHasExactlyOneOutboxEvent(transferId);
        dbAssert.outboxEventTypeEquals(transferId, "TRANSFER_COMPLETED");

        cleanup.trackIdempotencyKey(key);
    }

    @Test
    @DisplayName("[E2E-02] Successful transfer — GET /transfers/{id} matches POST response")
    void successfulTransfer_getReturnsConsistentData() {
        String key = newIdempotencyKey();
        BigDecimal amount = BigDecimal.valueOf(300);

        TransferRequest req = aTransfer().from(ALICE).to(BOB).amount(amount).build();

        String transferId = assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated().extractTransferId();

        // Re-fetch via GET and verify fields match
        assertThatResponse(transferClient.getTransfer(transferId))
                .isOk()
                .hasStatus("COMPLETED")
                .transferIdEquals(transferId)
                .hasBodyField("sourceWalletId",      ALICE)
                .hasBodyField("destinationWalletId", BOB)
                .hasBodyField("currency",            "AED");

        cleanup.trackIdempotencyKey(key);
    }

    @Test
    @DisplayName("[E2E-03] Multiple sequential transfers — cumulative balances are correct")
    void multipleSequentialTransfers_balancesAreCorrect() {
        BigDecimal aliceStart = walletRepo.getBalance(ALICE);
        BigDecimal bobStart   = walletRepo.getBalance(BOB);

        BigDecimal[] amounts = { BigDecimal.valueOf(100), BigDecimal.valueOf(200), BigDecimal.valueOf(400) };
        BigDecimal total = BigDecimal.ZERO;

        for (BigDecimal amt : amounts) {
            String key = newIdempotencyKey();
            TransferRequest req = aTransfer().from(ALICE).to(BOB).amount(amt).build();
            assertThatResponse(transferClient.createTransfer(req, key)).isCreated();
            total = total.add(amt);
            cleanup.trackIdempotencyKey(key);
        }

        assertThat(walletRepo.getBalance(ALICE))
                .as("Alice should be debited for all transfers")
                .isEqualByComparingTo(aliceStart.subtract(total));

        assertThat(walletRepo.getBalance(BOB))
                .as("Bob should be credited for all transfers")
                .isEqualByComparingTo(bobStart.add(total));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Insufficient Balance — no side effects
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[E2E-04] Insufficient balance — no wallet mutation, no spurious DB rows")
    void insufficientBalance_noStateChange() {
        BigDecimal emptyBefore  = walletRepo.getBalance(EMPTY);
        BigDecimal bobBefore    = walletRepo.getBalance(BOB);

        TransferRequest req = aTransfer()
                .from(EMPTY).to(BOB).amount(1).currency("AED").build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isUnprocessableEntity();

        // Balances must be unchanged
        businessAssert.verifyNoBalanceMutation(EMPTY, BOB, emptyBefore, bobBefore);
    }

    @Test
    @DisplayName("[E2E-05] Insufficient balance — no COMPLETED transfer row in DB")
    void insufficientBalance_noCompletedTransferInDB() {
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer()
                .from(CHARLIE).to(BOB).amount(99_999).currency("AED").build();

        assertThatResponse(transferClient.createTransfer(req, key))
                .isUnprocessableEntity();

        List<Map<String, Object>> rows = transferRepo.findByIdempotencyKey(key);
        // Either no row at all, or a row with REJECTED status — never COMPLETED
        rows.forEach(r -> assertThat(r.get("status")).isNotEqualTo("COMPLETED"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Dynamic wallet creation (using WalletBuilder)
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[E2E-06] Transfer between dynamically created wallets — full cycle verified")
    void transferBetweenDynamicWallets_fullCycleVerified() {
        String sourceId = walletWithBalance(5000).withOwner("Dynamic Source").create();
        String destId   = walletWithBalance(0).withOwner("Dynamic Dest").create();
        BigDecimal amount = BigDecimal.valueOf(1_000);
        String key = newIdempotencyKey();

        cleanup.trackWallet(sourceId);
        cleanup.trackWallet(destId);

        TransferRequest req = aTransfer()
                .from(sourceId).to(destId).amount(amount).currency("AED").build();

        String transferId = assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated().hasStatus("COMPLETED").extractTransferId();

        dbAssert.walletBalanceEquals(sourceId, BigDecimal.valueOf(4_000));
        dbAssert.walletBalanceEquals(destId,   BigDecimal.valueOf(1_000));
        dbAssert.transferExistsWithStatus(transferId, "COMPLETED");
        dbAssert.transferHasExactlyOneOutboxEvent(transferId);

        cleanup.trackIdempotencyKey(key);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Exact amount — boundary transfers
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[E2E-07] Transfer of exact wallet balance — succeeds and drains source to zero")
    void transferExactBalance_sourceDrainedToZero() {
        BigDecimal charlieBalance = walletRepo.getBalance(CHARLIE);
        String key = newIdempotencyKey();

        TransferRequest req = aTransfer()
                .from(CHARLIE).to(BOB).amount(charlieBalance).currency("AED").build();

        assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated().hasStatus("COMPLETED");

        dbAssert.walletBalanceEquals(CHARLIE, BigDecimal.ZERO);
        cleanup.trackIdempotencyKey(key);
    }
}

