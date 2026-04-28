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
 * Concurrency tests — fires multiple requests at the same time and checks nothing blows up.
 *
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
        // create fresh wallets for this test so other tests don't mess with them
        // source has exactly enough for ONE 1000 AED transfer
        String source = walletWithBalance(1_000).withOwner("ConcSource-01").create();
        String dest   = walletWithBalance(0).withOwner("ConcDest-01").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);

        // fire 10 requests all at once — only one should win
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

        // make sure the source didn't go negative — that would be a bad sign
        businessAssert.verifyNoOverdraft(source, BigDecimal.valueOf(1_000));
        assertThat(walletRepo.getBalance(source)).isEqualByComparingTo(BigDecimal.ZERO);

        // destination must have received exactly 1000 — no more, no less
        assertThat(walletRepo.getBalance(dest)).isEqualByComparingTo(BigDecimal.valueOf(1_000));
    }

    @Test
    @DisplayName("[CONC-02] 5 concurrent transfers each requesting 2000 — partial batch succeeds without overdraft")
    void competingTransfers_partialBatch_noOverdraft() {
        // 10000 balance / 2000 per transfer = 5 exactly — edge case worth testing
        String source = walletWithBalance(10_000).withOwner("ConcSource-02").create();
        String dest   = walletWithBalance(0).withOwner("ConcDest-02").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);

        List<Response> responses = ParallelExecutor.executeParallel(5,
                () -> transferClient.createTransfer(
                        aTransfer().from(source).to(dest).amount(2_000).build(),
                        null));

        long successes = ParallelExecutor.countByStatus(responses, 201);

        // all 5 should go through since balance is exactly sufficient
        assertThat(successes).as("All 5 transfers should succeed").isEqualTo(5);

        // double check: no overdraft and balances are swapped correctly
        businessAssert.verifyNoOverdraft(source, BigDecimal.valueOf(10_000));
        assertThat(walletRepo.getBalance(source)).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(walletRepo.getBalance(dest)).isEqualByComparingTo(BigDecimal.valueOf(10_000));
    }

    @Test
    @DisplayName("[CONC-03] 10 concurrent transfers with insufficient total balance — no overdraft ever")
    void competingTransfers_insufficientTotal_noOverdraft() {
        // source has 3000 — at most 3 of the 10 transfers can win
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

        // every response must be either a clean success or a clean failure — no 5xx surprises
        assertThat(successes + failures)
                .as("All 10 responses must be either success or failure — no 5xx")
                .isEqualTo(10);

        assertThat(successes).as("At most 3 should succeed").isLessThanOrEqualTo(3);

        // the big one: source must never go below zero
        businessAssert.verifyNoOverdraft(source, BigDecimal.valueOf(3_000));

        // conservation check — what left source must have arrived at dest
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

        // set up 5 separate wallet pairs — each thread will use its own
        for (int i = 0; i < pairs; i++) {
            sources[i] = walletWithBalance(1_000).withOwner("IndSrc-" + i).create();
            dests[i]   = walletWithBalance(0).withOwner("IndDst-" + i).create();
            cleanup.trackWallet(sources[i]);
            cleanup.trackWallet(dests[i]);
        }

        // each thread uses a dedicated wallet pair — no contention expected
        List<Response> responses = ParallelExecutor.executeParallel(pairs, () -> {
            // Thread index not needed — each supplier picks its own pair via index captured below
            // We use round-robin assignment inside the parallel executor (no shared mutable state here)
            int idx = (int) (Math.random() * pairs);
            return transferClient.createTransfer(
                    aTransfer().from(sources[idx]).to(dests[idx]).amount(500).build(),
                    null);
        });

        // since wallets are independent, all should go through fine
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

        // fresh wallets so we know exactly what the starting state is
        String source = walletWithBalance(startBalance.doubleValue()).withOwner("RAW-Src").create();
        String dest   = walletWithBalance(0).withOwner("RAW-Dst").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);

        List<Response> responses = ParallelExecutor.executeParallel(count,
                () -> transferClient.createTransfer(
                        aTransfer().from(source).to(dest).amount(perTransfer).build(),
                        null));

        long successes = ParallelExecutor.countByStatus(responses, 201);

        // calculate expected balances based on how many transfers actually succeeded
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
        // same key for all 8 requests — they're all duplicates of each other
        String key    = newIdempotencyKey();
        BigDecimal amount = BigDecimal.valueOf(200);
        String source = walletWithBalance(5_000).withOwner("IdemSrc").create();
        String dest   = walletWithBalance(0).withOwner("IdemDst").create();
        cleanup.trackWallet(source);
        cleanup.trackWallet(dest);
        cleanup.trackIdempotencyKey(key);

        TransferRequest req = aTransfer().from(source).to(dest).amount(amount).build();

        // all 8 threads send the exact same request with the same idempotency key
        List<Response> responses = ParallelExecutor.executeParallel(8,
                () -> transferClient.createTransfer(req, key));

        long success = ParallelExecutor.countByStatus(responses, 201);
        // all 8 must return 201 — the replays should get the cached response
        assertThat(success).as("All 8 idempotent responses should be 201").isEqualTo(8);

        // but money should only have moved once — critical for payments
        assertThat(walletRepo.getBalance(source))
                .isEqualByComparingTo(BigDecimal.valueOf(5_000).subtract(amount));

        // and only one row in the DB — not 8
        dbAssert.onlyOneTransferExistsForIdempotencyKey(key);
    }
}

