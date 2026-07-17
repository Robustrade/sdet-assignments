package com.robustrade.wallet.tests;

import com.robustrade.wallet.dto.TransferRequestDto;
import com.robustrade.wallet.support.BaseTest;
import com.robustrade.wallet.support.TestData;
import io.restassured.response.Response;
import org.testng.annotations.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertTrue;

/**
 * These tests fire real, genuinely concurrent HTTP requests at the running
 * server (separate threads, a CountDownLatch to release them together) --
 * they are the ones that actually exercise the row-locking and idempotency
 * claim-first logic in TransferService, rather than just asserting on
 * sequential calls.
 */
public class ConcurrencyReliabilityTests extends BaseTest {

    @Test
    public void twoConcurrentTransfers_competingForTheSameLimitedBalance_onlyOneSucceeds() throws Exception {
        // Wallet has just enough for ONE of the two transfers below, not both.
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destinationA = testData.seedWallet("USD", new BigDecimal("0.00"));
        String destinationB = testData.seedWallet("USD", new BigDecimal("0.00"));

        TransferRequestDto requestA = TestData.transferRequest(source, destinationA, new BigDecimal("70.00"), "USD");
        TransferRequestDto requestB = TestData.transferRequest(source, destinationB, new BigDecimal("70.00"), "USD");

        List<Response> results = runConcurrently(
                () -> api.createTransfer(requestA, null),
                () -> api.createTransfer(requestB, null)
        );

        long completedCount = results.stream()
                .filter(r -> "COMPLETED".equals(r.jsonPath().getString("status")))
                .count();
        long rejectedCount = results.stream()
                .filter(r -> "REJECTED".equals(r.jsonPath().getString("status")))
                .count();

        // Both requests get a clean, well-formed answer (200) -- but the wallet
        // only had funds for one of them, so exactly one must complete and the
        // other must be rejected. Neither request is allowed to error out or hang.
        assertEquals(completedCount, 1, "exactly one of the two competing transfers should complete");
        assertEquals(rejectedCount, 1, "the other transfer should be cleanly rejected, not corrupted or lost");

        // The source wallet should reflect exactly one debit of 70, never two.
        assertEquals(db.walletBalance(source), new BigDecimal("30.0000"));
    }

    @Test
    public void concurrentDuplicateSubmissions_sameIdempotencyKey_onlyProcessedOnce() throws Exception {
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("0.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("40.00"), "USD");
        String key = TestData.newIdempotencyKey();

        List<Response> results = runConcurrently(
                () -> api.createTransfer(request, key),
                () -> api.createTransfer(request, key),
                () -> api.createTransfer(request, key)
        );

        List<String> transferIds = results.stream()
                .map(r -> r.jsonPath().getString("transfer_id"))
                .distinct()
                .collect(Collectors.toList());

        // All three requests must resolve to the SAME transfer id...
        assertEquals(transferIds.size(), 1, "all duplicate submissions must resolve to the same transfer");

        // ...and the wallet must only have been debited once, not three times.
        assertEquals(db.walletBalance(source), new BigDecimal("60.0000"));
        assertEquals(db.walletBalance(destination), new BigDecimal("40.0000"));
        assertEquals(db.idempotencyRowCount(key), 1);
    }

    /** Runs the given calls on separate threads, released together, and returns all responses. */
    @SafeVarargs
    private List<Response> runConcurrently(Callable<Response>... calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.length);
        CountDownLatch readyLatch = new CountDownLatch(calls.length);
        CountDownLatch startLatch = new CountDownLatch(1);

        try {
            List<Future<Response>> futures = List.of(calls).stream()
                    .map(call -> pool.submit(() -> {
                        readyLatch.countDown();
                        startLatch.await();
                        return call.call();
                    }))
                    .collect(Collectors.toList());

            readyLatch.await(); // wait until every thread is queued up and about to fire
            startLatch.countDown(); // release them all at once

            List<Response> responses = futures.stream().map(f -> {
                try {
                    return f.get();
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }).collect(Collectors.toList());

            for (Response r : responses) {
                assertTrue(r.statusCode() < 500, "no request should fail with a server error: " + r.statusCode());
            }
            return responses;
        } finally {
            pool.shutdownNow();
        }
    }
}
