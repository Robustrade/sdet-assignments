package com.wallet.tests.idempotency;

import com.wallet.model.TransferRequest;
import com.wallet.model.TransferResponse;
import com.wallet.tests.BaseIntegrationTest;
import com.wallet.utils.ParallelExecutor;
import io.restassured.response.Response;
import org.junit.jupiter.api.*;

import java.math.BigDecimal;
import java.util.List;

import static com.wallet.assertions.ApiAssertions.assertThatResponse;
import static com.wallet.builders.TransferRequestBuilder.aTransfer;
import static com.wallet.fixtures.TestDataSeeder.*;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Idempotency tests — probably the most important ones in this whole suite.
 * Makes sure that retrying the same request doesn't charge the user twice.
 * Also verifies that different payloads with the same key get rejected as a conflict.
 * Every test gets its own unique key so there's no shared state between them.
 */
@DisplayName("Idempotency — Exactly-Once Guarantee Tests")
@TestMethodOrder(MethodOrderer.DisplayName.class)
class IdempotencyTests extends BaseIntegrationTest {

    // ─────────────────────────────────────────────────────────────────────────
    //  Same key + same payload → replay
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[IDEM-01] Replaying same key + same payload returns the original transfer id")
    void replay_samekeyAndPayload_returnsOriginalTransferId() {
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(500).reference("idem-01").build();

        cleanup.trackIdempotencyKey(key);

        // first call — this one actually does the work
        String firstTransferId = assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated().hasStatus("COMPLETED").extractTransferId();

        // same key, same payload — should get back the exact same transfer id
        String replayTransferId = assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated().hasStatus("COMPLETED").extractTransferId();

        assertThat(replayTransferId)
                .as("Replay must return the original transfer id")
                .isEqualTo(firstTransferId);
    }

    @Test
    @DisplayName("[IDEM-02] Replaying does not debit source wallet a second time")
    void replay_doesNotDoubleDebit() {
        String key = newIdempotencyKey();
        BigDecimal amount     = BigDecimal.valueOf(1_000);
        // snapshot Alice's balance before anything happens
        BigDecimal aliceBefore = walletRepo.getBalance(ALICE);

        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(amount).reference("idem-02").build();

        cleanup.trackIdempotencyKey(key);

        // first call does the real debit
        transferClient.createTransfer(req, key);
        BigDecimal afterFirst = walletRepo.getBalance(ALICE);

        // second call with same key — should NOT touch the balance
        transferClient.createTransfer(req, key);
        BigDecimal afterReplay = walletRepo.getBalance(ALICE);

        assertThat(afterFirst)
                .as("First call should debit Alice by %s", amount)
                .isEqualByComparingTo(aliceBefore.subtract(amount));

        // this is the main check — replay must not debit again
        assertThat(afterReplay)
                .as("Replay must NOT debit Alice again — balance must be unchanged from after-first")
                .isEqualByComparingTo(afterFirst);
    }

    @Test
    @DisplayName("[IDEM-03] Replaying does not credit destination wallet a second time")
    void replay_doesNotDoubleCredit() {
        String key = newIdempotencyKey();
        BigDecimal amount   = BigDecimal.valueOf(750);
        BigDecimal bobBefore = walletRepo.getBalance(BOB);

        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(amount).reference("idem-03").build();
        cleanup.trackIdempotencyKey(key);

        // do the real transfer
        transferClient.createTransfer(req, key);
        BigDecimal afterFirst = walletRepo.getBalance(BOB);

        // replay — Bob's balance must not go up again
        transferClient.createTransfer(req, key);
        BigDecimal afterReplay = walletRepo.getBalance(BOB);

        assertThat(afterFirst)
                .as("First call should credit Bob by %s", amount)
                .isEqualByComparingTo(bobBefore.add(amount));

        assertThat(afterReplay)
                .as("Replay must NOT credit Bob again")
                .isEqualByComparingTo(afterFirst);
    }

    @Test
    @DisplayName("[IDEM-04] Only one transfer row exists in DB after multiple replays")
    void replay_onlyOneTransferRowInDB() {
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(200).reference("idem-04").build();
        cleanup.trackIdempotencyKey(key);

        // submit 5 times with the same key — should only create one row
        for (int i = 0; i < 5; i++) {
            transferClient.createTransfer(req, key);
        }

        // one row no matter how many retries
        dbAssert.onlyOneTransferExistsForIdempotencyKey(key);
    }

    @Test
    @DisplayName("[IDEM-05] Idempotency key record exists in DB after first submission")
    void afterFirstSubmission_idempotencyKeyStoredInDB() {
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(300).reference("idem-05").build();
        cleanup.trackIdempotencyKey(key);

        transferClient.createTransfer(req, key);

        // the key and its status should now be persisted
        dbAssert.idempotencyKeyExists(key);
        dbAssert.idempotencyKeyStatus(key, "COMPLETED");
    }

    @Test
    @DisplayName("[IDEM-06] Only one outbox event is created even after replay")
    void replay_onlyOneOutboxEvent() {
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(400).reference("idem-06").build();
        cleanup.trackIdempotencyKey(key);

        String transferId = assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated().extractTransferId();

        // replay — no extra outbox event should be written
        transferClient.createTransfer(req, key);

        // still exactly one outbox event, not two
        dbAssert.transferHasExactlyOneOutboxEvent(transferId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Same key + different payload → Conflict
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[IDEM-07] Same key + different amount → 409 Conflict")
    void sameKeyDifferentAmount_returns409() {
        String key = newIdempotencyKey();
        TransferRequest original  = aTransfer().from(ALICE).to(BOB).amount(100).build();
        TransferRequest different = aTransfer().from(ALICE).to(BOB).amount(999).build();
        cleanup.trackIdempotencyKey(key);

        // first request locks in the payload for this key
        assertThatResponse(transferClient.createTransfer(original, key)).isCreated();

        // second request with same key but different amount — must be rejected
        assertThatResponse(transferClient.createTransfer(different, key))
                .isConflict()
                .hasErrorMessageContaining("conflict");
    }

    @Test
    @DisplayName("[IDEM-08] Same key + different destination → 409 Conflict")
    void sameKeyDifferentDestination_returns409() {
        String key = newIdempotencyKey();
        TransferRequest original  = aTransfer().from(ALICE).to(BOB).amount(100).build();
        TransferRequest different = aTransfer().from(ALICE).to(CHARLIE).amount(100).build();
        cleanup.trackIdempotencyKey(key);

        // first call succeeds and binds this key to BOB as destination
        assertThatResponse(transferClient.createTransfer(original, key)).isCreated();

        // trying to send to CHARLIE with the same key — should conflict
        assertThatResponse(transferClient.createTransfer(different, key))
                .isConflict();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Concurrent duplicate submission (race condition safety)
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[IDEM-09] Concurrent duplicate submissions — exactly one transfer created")
    void concurrentDuplicateSubmissions_exactlyOneTransferCreated() {
        String key = newIdempotencyKey();
        BigDecimal amount = BigDecimal.valueOf(100);
        cleanup.trackIdempotencyKey(key);

        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(amount).reference("idem-09").build();

        // fire 10 identical requests at the same time — real-world network retry scenario
        List<Response> responses = ParallelExecutor.executeParallel(10,
                () -> transferClient.createTransfer(req, key));

        // all should return 201 — whether they actually processed or just replayed
        long success = ParallelExecutor.countByStatus(responses, 201);
        assertThat(success)
                .as("All concurrent identical requests must result in success (201)")
                .isEqualTo(10);

        // but the DB should only have one row — no duplicates
        dbAssert.onlyOneTransferExistsForIdempotencyKey(key);

        // and alice should have been debited exactly once
        BigDecimal aliceNow = walletRepo.getBalance(ALICE);
        assertThat(aliceNow)
                .as("Alice must be debited exactly once, not %d times", 10)
                .isEqualByComparingTo(ALICE_BALANCE.subtract(amount));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  No idempotency key provided — treated as unique request
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[IDEM-10] Requests without idempotency key are treated as independent")
    void noIdempotencyKey_eachRequestIsIndependent() {
        BigDecimal aliceBefore = walletRepo.getBalance(ALICE);
        BigDecimal amount      = BigDecimal.valueOf(100);

        // two identical payloads, but no idempotency key — treated as two separate transfers
        Response r1 = transferClient.createTransfer(
                aTransfer().from(ALICE).to(BOB).amount(amount).build(), null);
        Response r2 = transferClient.createTransfer(
                aTransfer().from(ALICE).to(BOB).amount(amount).build(), null);

        assertThatResponse(r1).isCreated();
        assertThatResponse(r2).isCreated();

        // two different transfer ids — proves they're independent
        String id1 = r1.jsonPath().getString("transferId");
        String id2 = r2.jsonPath().getString("transferId");
        assertThat(id1).as("Two requests without key must produce two distinct transfer ids")
                .isNotEqualTo(id2);

        // Alice should be debited twice since there's no idempotency protection here
        assertThat(walletRepo.getBalance(ALICE))
                .isEqualByComparingTo(aliceBefore.subtract(amount.multiply(BigDecimal.valueOf(2))));
    }
}

