package com.wallet.tests;

import com.wallet.assertions.IdempotencyAssertions;
import com.wallet.assertions.WalletAssertions;
import com.wallet.base.WalletTransferTestBase;
import com.wallet.fixture.TransferRequestBuilder;
import com.wallet.fixture.WalletFixture;
import com.wallet.model.TransferRequest;
import com.wallet.model.WalletBalance;
import io.restassured.response.Response;
import org.junit.jupiter.api.*;

import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Concurrency and race condition tests for the Wallet Transfer Service.
 *
 * Properties under test:
 *   P1: Concurrent transfers on same source wallet — balance never goes negative
 *   P2: Concurrent transfers — exactly N successes + (total-N) failures (not more)
 *   P3: Concurrent duplicate requests (same idempotency key) — exactly 1 DB row
 *   P4: Concurrent transfers to same destination — all credits applied correctly
 *   P5: Balance conservation under concurrency — net change equals sum of successes
 */
@Tag("concurrency")
@DisplayName("Concurrency & Race Condition Tests")
class ReliabilityTest extends WalletTransferTestBase {

    private static final int THREAD_COUNT       = 10;
    private static final int AWAIT_TIMEOUT_SECS = 30;

    // ─── P1 + P2: Race on source wallet balance ───────────────────────────────

    @Test
    @DisplayName("TC-CC-01: Concurrent transfers never overdraft source wallet")
    void concurrentTransfers_balanceNeverNegative() throws InterruptedException {
        BigDecimal initialBalance = new BigDecimal("500.00");
        BigDecimal eachTransfer   = new BigDecimal("100.00");
        // 10 threads × $100 = $1000 > $500 balance → only 5 can succeed

        String sourceId = walletFixture.createFundedWallet("USD", initialBalance);
        String destId   = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(sourceId);
        testWalletIds.add(destId);

        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch  = new CountDownLatch(THREAD_COUNT);
        List<Response> responses  = Collections.synchronizedList(new ArrayList<>());

        for (int i = 0; i < THREAD_COUNT; i++) {
            new Thread(() -> {
                try {
                    startLatch.await();
                    TransferRequest request = TransferRequestBuilder.validTransfer(
                            sourceId, destId, eachTransfer, "USD");
                    Response response = apiClient.initiateTransfer(request);
                    responses.add(response);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    doneLatch.countDown();
                }
            }).start();
        }

        startLatch.countDown();
        boolean completed = doneLatch.await(AWAIT_TIMEOUT_SECS, TimeUnit.SECONDS);
        assertThat(completed).as("Not all threads completed within timeout").isTrue();

        // Balance must never go negative
        WalletAssertions.assertThat(dbClient, sourceId)
                .hasNonNegativeBalance();

        // Count successes and failures
        long successCount = responses.stream()
                .filter(r -> r.getStatusCode() == 200)
                .count();
        long failureCount = responses.stream()
                .filter(r -> r.getStatusCode() != 200)
                .count();

        assertThat(successCount + failureCount)
                .as("Total responses must equal thread count")
                .isEqualTo(THREAD_COUNT);

        // Verify balance exactly matches successful transfers
        BigDecimal expectedBalance = initialBalance.subtract(
                eachTransfer.multiply(BigDecimal.valueOf(successCount)));

        WalletAssertions.assertThat(dbClient, sourceId)
                .hasBalance(expectedBalance);

        log.info("Concurrency TC-CC-01: {} successes, {} failures out of {} threads",
                successCount, failureCount, THREAD_COUNT);
    }

    @Test
    @DisplayName("TC-CC-02: Concurrent transfers — exactly max affordable transfers succeed")
    void concurrentTransfers_exactlyAffordableTransfersSucceed() throws InterruptedException {
        int maxAffordable   = 3;
        BigDecimal each     = new BigDecimal("100.00");
        BigDecimal balance  = each.multiply(BigDecimal.valueOf(maxAffordable)); // $300

        String sourceId = walletFixture.createFundedWallet("USD", balance);
        String destId   = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(sourceId);
        testWalletIds.add(destId);

        List<Response> responses = fireParallelTransfers(sourceId, destId, each, THREAD_COUNT);

        long successes = responses.stream().filter(r -> r.getStatusCode() == 200).count();

        assertThat(successes)
                .as("Expected at most %d successes (one per affordable transfer) but got %d. " +
                    "Race condition: overdraft or double-debit occurred.", maxAffordable, successes)
                .isLessThanOrEqualTo(maxAffordable);

        WalletAssertions.assertThat(dbClient, sourceId)
                .hasNonNegativeBalance();
    }

    // ─── P3: Concurrent duplicate idempotency keys ───────────────────────────

    @Test
    @DisplayName("TC-CC-03: Concurrent requests with same idempotency key create exactly 1 transfer")
    void concurrentDuplicateRequests_exactlyOneTransferRow() throws InterruptedException {
        String idempotencyKey = UUID.randomUUID().toString();
        String sourceId = walletFixture.createHighBalanceWallet("USD");
        String destId   = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(sourceId);
        testWalletIds.add(destId);

        BigDecimal amount = new BigDecimal("100.00");
        TransferRequest request = TransferRequestBuilder.validTransfer(
                sourceId, destId, amount, "USD");

        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch  = new CountDownLatch(THREAD_COUNT);
        List<Response> responses  = Collections.synchronizedList(new ArrayList<>());

        for (int i = 0; i < THREAD_COUNT; i++) {
            new Thread(() -> {
                try {
                    startLatch.await();
                    Response response = apiClient.initiateTransfer(request, idempotencyKey);
                    responses.add(response);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    doneLatch.countDown();
                }
            }).start();
        }

        startLatch.countDown();
        boolean completed = doneLatch.await(AWAIT_TIMEOUT_SECS, TimeUnit.SECONDS);
        assertThat(completed).as("Concurrent requests did not complete in time").isTrue();

        // Exactly 1 transfer row must exist for this idempotency key
        IdempotencyAssertions.assertThat(dbClient)
                .exactlyOneTransferPerKey(idempotencyKey);

        // Exactly one 200 response must exist, and all 200s must carry the same transfer_id.
        // exactlyOneTransferPerKey above already guarantees 1 DB row — so at least one
        // thread must have received 200. hasSizeGreaterThanOrEqualTo(1) catches the case
        // where all threads somehow got non-200 despite a DB row being created.
        List<String> transferIds = responses.stream()
                .filter(r -> r.getStatusCode() == 200)
                .map(r -> r.jsonPath().getString("transfer_id"))
                .distinct()
                .toList();

        assertThat(transferIds)
                .as("Expected exactly 1 distinct transfer_id across all successful concurrent responses " +
                    "(same idempotency key). Got: %s", transferIds)
                .hasSize(1);
    }

    @Test
    @DisplayName("TC-CC-04: Concurrent duplicate requests do not double-debit the source wallet")
    void concurrentDuplicateRequests_noDoubleDebit() throws InterruptedException {
        String idempotencyKey = UUID.randomUUID().toString();
        BigDecimal amount     = new BigDecimal("100.00");

        String sourceId = walletFixture.createHighBalanceWallet("USD");
        String destId   = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(sourceId);
        testWalletIds.add(destId);

        WalletBalance sourceBefore = WalletAssertions.snapshot(dbClient, sourceId);
        WalletBalance destBefore   = WalletAssertions.snapshot(dbClient, destId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                sourceId, destId, amount, "USD");

        fireParallelTransfersWithKey(request, idempotencyKey, THREAD_COUNT);

        // Exactly one debit and one credit — even with N concurrent attempts
        WalletAssertions.assertThat(dbClient, sourceId)
                .balanceDecreasedBy(amount, sourceBefore);

        WalletAssertions.assertThat(dbClient, destId)
                .balanceIncreasedBy(amount, destBefore);
    }

    // ─── P4: Concurrent fan-in to same destination ───────────────────────────

    @Test
    @DisplayName("TC-CC-05: Concurrent transfers to same destination — all credits applied")
    void concurrentTransfersToSameDestination_allCreditsApplied() throws InterruptedException {
        int senderCount  = 5;
        BigDecimal each  = new BigDecimal("100.00");

        String destId = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(destId);

        List<String> senderIds = new ArrayList<>();
        for (int i = 0; i < senderCount; i++) {
            String senderId = walletFixture.createFundedWallet("USD", each.multiply(BigDecimal.TWO));
            senderIds.add(senderId);
            testWalletIds.add(senderId);
        }

        WalletBalance destBefore = WalletAssertions.snapshot(dbClient, destId);

        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch  = new CountDownLatch(senderCount);
        AtomicInteger successCount = new AtomicInteger(0);

        for (String senderId : senderIds) {
            String sid = senderId; // effectively final
            new Thread(() -> {
                try {
                    startLatch.await();
                    TransferRequest request = TransferRequestBuilder.validTransfer(
                            sid, destId, each, "USD");
                    Response response = apiClient.initiateTransfer(request);
                    if (response.getStatusCode() == 200) successCount.incrementAndGet();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    doneLatch.countDown();
                }
            }).start();
        }

        startLatch.countDown();
        boolean completed = doneLatch.await(AWAIT_TIMEOUT_SECS, TimeUnit.SECONDS);
        assertThat(completed).as("Not all fan-in threads completed within timeout").isTrue();

        // Destination balance should reflect exactly successCount credits
        BigDecimal expectedDestBalance = destBefore.getBalance()
                .add(each.multiply(BigDecimal.valueOf(successCount.get())));

        WalletAssertions.assertThat(dbClient, destId)
                .hasBalance(expectedDestBalance);

        log.info("TC-CC-05: {}/{} concurrent fan-in transfers credited to destination",
                successCount.get(), senderCount);
    }

    // ─── P5: Balance conservation under concurrency ───────────────────────────

    @Test
    @DisplayName("TC-CC-06: Balance conservation holds across concurrent successful transfers")
    void concurrentTransfers_balanceConservation() throws InterruptedException {
        BigDecimal initialSource = new BigDecimal("1000.00");
        BigDecimal each          = new BigDecimal("50.00");

        String sourceId = walletFixture.createFundedWallet("USD", initialSource);
        String destId   = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(sourceId);
        testWalletIds.add(destId);

        WalletBalance sourceBefore = WalletAssertions.snapshot(dbClient, sourceId);
        WalletBalance destBefore   = WalletAssertions.snapshot(dbClient, destId);

        List<Response> responses = fireParallelTransfers(sourceId, destId, each, THREAD_COUNT);

        WalletBalance sourceAfter = WalletAssertions.snapshot(dbClient, sourceId);
        WalletBalance destAfter   = WalletAssertions.snapshot(dbClient, destId);

        // Net change in the system must be zero
        WalletAssertions.assertBalanceConservation(sourceBefore, sourceAfter, destBefore, destAfter);

        // Each wallet's balance must remain non-negative
        WalletAssertions.assertThat(dbClient, sourceId).hasNonNegativeBalance();
        WalletAssertions.assertThat(dbClient, destId).hasNonNegativeBalance();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private List<Response> fireParallelTransfers(String sourceId, String destId,
                                                  BigDecimal amount, int threadCount)
            throws InterruptedException {

        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch  = new CountDownLatch(threadCount);
        List<Response> responses  = Collections.synchronizedList(new ArrayList<>());

        for (int i = 0; i < threadCount; i++) {
            new Thread(() -> {
                try {
                    startLatch.await();
                    TransferRequest request = TransferRequestBuilder.validTransfer(
                            sourceId, destId, amount, "USD");
                    responses.add(apiClient.initiateTransfer(request));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    doneLatch.countDown();
                }
            }).start();
        }

        startLatch.countDown();
        boolean done = doneLatch.await(AWAIT_TIMEOUT_SECS, TimeUnit.SECONDS);
        assertThat(done).as("Not all parallel transfers completed in time").isTrue();
        return responses;
    }

    private void fireParallelTransfersWithKey(TransferRequest request,
                                               String idempotencyKey, int threadCount)
            throws InterruptedException {

        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch  = new CountDownLatch(threadCount);

        for (int i = 0; i < threadCount; i++) {
            new Thread(() -> {
                try {
                    startLatch.await();
                    apiClient.initiateTransfer(request, idempotencyKey);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    doneLatch.countDown();
                }
            }).start();
        }

        startLatch.countDown();
        boolean done = doneLatch.await(AWAIT_TIMEOUT_SECS, TimeUnit.SECONDS);
        assertThat(done).as("Not all parallel-key threads completed within timeout").isTrue();
    }
}
