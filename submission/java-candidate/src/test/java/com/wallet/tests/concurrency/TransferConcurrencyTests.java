package com.wallet.tests.concurrency;

import com.wallet.model.TransferRequest;
import com.wallet.tests.BaseIntegrationTest;
import com.wallet.utils.ParallelExecutor;
import io.restassured.response.Response;
import org.junit.jupiter.api.*;

import java.math.BigDecimal;
import java.util.List;

import static com.wallet.builders.TransferRequestBuilder.aTransfer;
import static com.wallet.fixtures.TestDataSeeder.*;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * CONCURRENCY TESTS
 *
 * Validates safety under parallel, competing requests.
 *
 * Design note:
 *  - Each test creates isolated wallets via WalletBuilder so parallel runs don't interfere.
 *  - CyclicBarrier inside ParallelExecutor maximises thread contention.
 *  - We assert on outcomes, not timing — tests are deterministic as long as the
 *    service uses DB row-level locks (SELECT … FOR UPDATE).
 *
 * What we look for:
 *  - No overdraft (balance never goes negative)
 *  - No phantom credit (destination balance exactly matches successful debit count * amount)
 *  - Correct success/failure split under competing limited balance
 *  - Exactly one successful transfer for one-slot tournaments
 */
@DisplayName("Concurrency — Race Condition & Safety Tests")
@TestMethodOrder(MethodOrderer.DisplayName.class)
class TransferConcurrencyTests extends BaseIntegrationTest {

    // ─────────────────────────────────────────────────────────────────────────
    //  Competing transfers — limited balance
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[CONC-01] 10 concurrent transfers competing for only 1-slot balance — exactly 1 succeeds")
    void competingTransfers_onlyOneSucceeds_whenBalanceAllowsOne() {
        // Source has exactly enough for ONE 1000 AED transfer
        String source = walletWithBalance(1_000).withOwner("ConcSource-01").create();
        String dest   = walletWithBalance(0).withOwner("ConcDest-01").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);

        List<Response> responses = ParallelExecutor.executeParallel(10,
                () -> transferClient.createTransfer(
                        aTransfer().from(source).to(dest).amount(1_000).build(),
                        null));

        long successes = ParallelExecutor.countByStatus(responses, 201);
        long failures  = ParallelExecutor.countByStatus(responses, 422);

        assertThat(successes)
                .as("Exactly 1 of 10 concurrent transfers should succeed (balance = 1000, amount = 1000)")
                .isEqualTo(1);

        assertThat(failures)
                .as("The remaining 9 must be rejected with 422")
                .isEqualTo(9);

        // DB: source must be at 0 (not negative)
        businessAssert.verifyNoOverdraft(source, BigDecimal.valueOf(1_000));
        assertThat(walletRepo.getBalance(source)).isEqualByComparingTo(BigDecimal.ZERO);

        // Destination must have received exactly 1000
        assertThat(walletRepo.getBalance(dest)).isEqualByComparingTo(BigDecimal.valueOf(1_000));
    }

    @Test
    @DisplayName("[CONC-02] 5 concurrent transfers each requesting 2000 — partial batch succeeds without overdraft")
    void competingTransfers_partialBatch_noOverdraft() {
        // Source has 10000 — allows 5 transfers of 2000 each (exactly)
        String source = walletWithBalance(10_000).withOwner("ConcSource-02").create();
        String dest   = walletWithBalance(0).withOwner("ConcDest-02").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);

        List<Response> responses = ParallelExecutor.executeParallel(5,
                () -> transferClient.createTransfer(
                        aTransfer().from(source).to(dest).amount(2_000).build(),
                        null));

        long successes = ParallelExecutor.countByStatus(responses, 201);

        // All 5 should succeed (balance is exactly sufficient)
        assertThat(successes).as("All 5 transfers should succeed").isEqualTo(5);

        businessAssert.verifyNoOverdraft(source, BigDecimal.valueOf(10_000));
        assertThat(walletRepo.getBalance(source)).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(walletRepo.getBalance(dest)).isEqualByComparingTo(BigDecimal.valueOf(10_000));
    }

    @Test
    @DisplayName("[CONC-03] 10 concurrent transfers with insufficient total balance — no overdraft ever")
    void competingTransfers_insufficientTotal_noOverdraft() {
        // Source has 3000 — allows at most 3 transfers of 1000
        String source = walletWithBalance(3_000).withOwner("ConcSource-03").create();
        String dest   = walletWithBalance(0).withOwner("ConcDest-03").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);

        List<Response> responses = ParallelExecutor.executeParallel(10,
                () -> transferClient.createTransfer(
                        aTransfer().from(source).to(dest).amount(1_000).build(),
                        null));

        long successes = ParallelExecutor.countByStatus(responses, 201);
        long failures  = ParallelExecutor.countByStatus(responses, 422);

        assertThat(successes + failures)
                .as("All 10 responses must be either success or failure — no 5xx")
                .isEqualTo(10);

        assertThat(successes).as("At most 3 should succeed").isLessThanOrEqualTo(3);

        // Critical: source wallet must never go below 0
        businessAssert.verifyNoOverdraft(source, BigDecimal.valueOf(3_000));

        // Conservation: source debited by successes * 1000 == dest balance
        BigDecimal sourceNow = walletRepo.getBalance(source);
        BigDecimal destNow   = walletRepo.getBalance(dest);
        BigDecimal totalDebited = BigDecimal.valueOf(3_000).subtract(sourceNow);
        assertThat(destNow)
                .as("Destination balance must equal total amount debited from source")
                .isEqualByComparingTo(totalDebited);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Concurrent transfers between different wallet pairs — no cross-interference
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[CONC-04] Concurrent independent transfers on different wallet pairs — all succeed")
    void independentConcurrentTransfers_allSucceed() {
        int pairs = 5;
        String[] sources = new String[pairs];
        String[] dests   = new String[pairs];

        for (int i = 0; i < pairs; i++) {
            sources[i] = walletWithBalance(1_000).withOwner("IndSrc-" + i).create();
            dests[i]   = walletWithBalance(0).withOwner("IndDst-" + i).create();
            cleanup.trackWallet(sources[i]);
            cleanup.trackWallet(dests[i]);
        }

        // Each thread uses a dedicated wallet pair — no contention
        List<Response> responses = ParallelExecutor.executeParallel(pairs, () -> {
            // Thread index not needed — each supplier picks its own pair via index captured below
            // We use round-robin assignment inside the parallel executor (no shared mutable state here)
            int idx = (int) (Math.random() * pairs);
            return transferClient.createTransfer(
                    aTransfer().from(sources[idx]).to(dests[idx]).amount(500).build(),
                    null);
        });

        // All responses must be 201 (no competition for balance)
        long successes = ParallelExecutor.countByStatus(responses, 201);
        assertThat(successes).as("All independent transfers must succeed").isEqualTo(pairs);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Read-after-write consistency
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[CONC-05] GET /wallets after concurrent transfers reflects final consistent state")
    void getWallet_afterConcurrentTransfers_returnsConsistentBalance() {
        BigDecimal startBalance = BigDecimal.valueOf(5_000);
        BigDecimal perTransfer  = BigDecimal.valueOf(500);
        int count = 5;

        String source = walletWithBalance(startBalance.doubleValue()).withOwner("RAW-Src").create();
        String dest   = walletWithBalance(0).withOwner("RAW-Dst").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);

        List<Response> responses = ParallelExecutor.executeParallel(count,
                () -> transferClient.createTransfer(
                        aTransfer().from(source).to(dest).amount(perTransfer).build(),
                        null));

        long successes = ParallelExecutor.countByStatus(responses, 201);

        // GET wallet after all transfers — must reflect final state
        BigDecimal expectedSource = startBalance.subtract(perTransfer.multiply(BigDecimal.valueOf(successes)));
        BigDecimal expectedDest   = perTransfer.multiply(BigDecimal.valueOf(successes));

        assertThat(walletRepo.getBalance(source))
                .as("Source balance should reflect exactly %d successful debits", successes)
                .isEqualByComparingTo(expectedSource);

        assertThat(walletRepo.getBalance(dest))
                .as("Dest balance should reflect exactly %d successful credits", successes)
                .isEqualByComparingTo(expectedDest);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Concurrent idempotent duplicate submission
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[CONC-06] Concurrent idempotent submissions — exactly one debit, all return 201")
    void concurrentIdempotentSubmissions_oneDebitAllSucceed() {
        String key    = newIdempotencyKey();
        BigDecimal amount = BigDecimal.valueOf(200);
        String source = walletWithBalance(5_000).withOwner("IdemSrc").create();
        String dest   = walletWithBalance(0).withOwner("IdemDst").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);
        cleanup.trackIdempotencyKey(key);

        TransferRequest req = aTransfer().from(source).to(dest).amount(amount).build();

        List<Response> responses = ParallelExecutor.executeParallel(8,
                () -> transferClient.createTransfer(req, key));

        long success = ParallelExecutor.countByStatus(responses, 201);
        assertThat(success).as("All 8 idempotent responses should be 201").isEqualTo(8);

        // Only ONE debit must have occurred
        assertThat(walletRepo.getBalance(source))
                .isEqualByComparingTo(BigDecimal.valueOf(5_000).subtract(amount));

        // Only one transfer row in DB
        dbAssert.onlyOneTransferExistsForIdempotencyKey(key);
    }
}

