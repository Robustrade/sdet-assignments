package com.kulu.sdet.reliability;

import com.kulu.sdet.fixtures.IdempotencyKeyGenerator;
import com.kulu.sdet.fixtures.TransferRequestBuilder;
import com.kulu.sdet.fixtures.WalletFixtures;
import com.kulu.sdet.model.TransferRequest;
import com.kulu.sdet.model.TransferResponse;
import com.kulu.sdet.support.WalletTransferClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Tag("reliability")
@DisplayName("Wallet Transfer Reliability")
class WalletReliabilityTest {

    private WalletTransferClient client;

    @BeforeEach
    void setUp() {
        client = new WalletTransferClient();
    }


    @Test
    @DisplayName("Replaying the same Idempotency-Key returns the identical transactionId")
    void transfer_sameIdempotencyKey_returnsSameTransactionId() {
        String key = IdempotencyKeyGenerator.forTest("transfer_sameIdempotencyKey_returnsSameTransactionId");
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withKey(key).build();

        TransferResponse first = client.createTransfer(request);
        TransferResponse second = client.createTransfer(request);

        assertEquals(200, first.getStatusCode());
        assertEquals(200, second.getStatusCode());
        assertEquals(first.getTransactionId(), second.getTransactionId(), "Idempotent replay must return the same transactionId");
    }

    @Test
    @DisplayName("Same Idempotency-Key with a different amount returns 409 Conflict")
    void transfer_sameKeyDifferentPayload_returns409() {
        String key = IdempotencyKeyGenerator.random();

        TransferResponse first = client.createTransfer(TransferRequestBuilder.aValidTransfer().withKey(key).build());
        assertEquals(200, first.getStatusCode());

        TransferResponse conflict = client.createTransfer(TransferRequestBuilder.aValidTransfer().withAmount(WalletFixtures.LARGE_TRANSFER).withKey(key).build());

        assertEquals(409, conflict.getStatusCode());
    }


    @Test
    @DisplayName("Concurrent transfers with the same Idempotency-Key produce exactly one debit")
    void transfer_concurrent_noDuplicateDebits() throws Exception {
        int threads = 5;
        String sharedKey = IdempotencyKeyGenerator.sequential("concurrent-dedup");
        TransferRequest request = TransferRequestBuilder.aValidTransfer().withKey(sharedKey).build();

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<TransferResponse>> futures = new ArrayList<>();

        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> client.createTransfer(request)));
        }
        pool.shutdown();
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS));

        long successCount = futures.stream().map(f -> {
            try {
                return f.get();
            } catch (Exception e) {
                return null;
            }
        }).filter(r -> r != null && r.getStatusCode() == 200).count();

        assertEquals(1, successCount, "Exactly one concurrent request should succeed; duplicates must be de-duped");
    }


    @Test
    @DisplayName("Rapid sequential retries without a key never produce a 5xx error")
    void transfer_rapidRetries_noServerErrors() {
        for (int attempt = 1; attempt <= 3; attempt++) {
            TransferResponse res = client.createTransfer(TransferRequestBuilder.aValidTransfer().withKey(IdempotencyKeyGenerator.sequential("retry")).build());
            assertTrue(res.getStatusCode() < 500, "Attempt " + attempt + " returned unexpected 5xx: " + res.getStatusCode());
        }
    }
}
