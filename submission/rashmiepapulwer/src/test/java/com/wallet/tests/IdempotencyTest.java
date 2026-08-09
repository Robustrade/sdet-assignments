package com.wallet.tests;

import com.wallet.assertions.IdempotencyAssertions;
import com.wallet.assertions.TransferAssertions;
import com.wallet.assertions.WalletAssertions;
import com.wallet.base.WalletTransferTestBase;
import com.wallet.fixture.TransferRequestBuilder;
import com.wallet.fixture.WalletFixture;
import com.wallet.model.TransferRequest;
import com.wallet.model.WalletBalance;
import io.restassured.response.Response;
import org.junit.jupiter.api.*;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Idempotency contract tests for the Wallet Transfer Service.
 *
 * Idempotency guarantees under test:
 *   G1: Identical requests with same key → same transfer_id, same HTTP status
 *   G2: Same key, different payload     → 409 Conflict
 *   G3: Only 1 transfer row per key     → no phantom double-writes
 *   G4: Only 1 balance mutation per key → balance changes exactly once
 *   G5: Key persisted in idempotency_keys table
 *   G6: Expired key reuse behaviour (if applicable)
 */
@Tag("idempotency")
@DisplayName("Idempotency Tests")
class IdempotencyTest extends WalletTransferTestBase {

    private String sourceId;
    private String destId;

    @BeforeEach
    void seedWallets() {
        WalletFixture.WalletPair pair = walletFixture.createTransferPair(
                "USD", new BigDecimal("2000.00")); // high balance for repeated transfer tests
        sourceId = pair.sourceId();
        destId   = pair.destinationId();
        testWalletIds.add(sourceId);
        testWalletIds.add(destId);
    }

    // ─── G1: Same key, same payload ───────────────────────────────────────────

    @Test
    @DisplayName("TC-ID-01: Duplicate request returns same transfer_id")
    void duplicateRequest_returnsSameTransferId() {
        String idempotencyKey = UUID.randomUUID().toString();
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response first  = apiClient.initiateTransfer(request, idempotencyKey);
        Response second = apiClient.initiateTransfer(request, idempotencyKey);

        first.then().statusCode(200);

        IdempotencyAssertions.assertThat(dbClient)
                .duplicateRequestReturnsSameTransferId(first, second)
                .duplicateRequestReturnsSameStatusCode(first, second);
    }

    @Test
    @DisplayName("TC-ID-02: Duplicate request returns same HTTP status code")
    void duplicateRequest_returnsSameHttpStatus() {
        String idempotencyKey = UUID.randomUUID().toString();
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response first  = apiClient.initiateTransfer(request, idempotencyKey);
        Response second = apiClient.initiateTransfer(request, idempotencyKey);

        IdempotencyAssertions.assertThat(dbClient)
                .duplicateRequestReturnsSameStatusCode(first, second);
    }

    @Test
    @DisplayName("TC-ID-03: Duplicate of a failed request returns same error response")
    void duplicateFailedRequest_returnsSameError() {
        String idempotencyKey = UUID.randomUUID().toString();
        // Empty source wallet → transfer will fail
        String emptySourceId = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(emptySourceId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                emptySourceId, destId, new BigDecimal("100.00"), "USD");

        Response first  = apiClient.initiateTransfer(request, idempotencyKey);
        // Guard: first request must have failed (empty wallet → 422). If it somehow
        // succeeded the duplicate assertion would verify idempotency on a success path,
        // not the failure path we intended to test.
        first.then().statusCode(422);

        Response second = apiClient.initiateTransfer(request, idempotencyKey);

        IdempotencyAssertions.assertThat(dbClient)
                .duplicateRequestReturnsSameStatusCode(first, second)
                .duplicateRequestReturnsSameTransferId(first, second);
    }

    // ─── G2: Same key, different payload ─────────────────────────────────────

    @Test
    @DisplayName("TC-ID-04: Same key with different amount returns 409 Conflict")
    void sameKeyDifferentAmount_returns409() {
        String idempotencyKey = UUID.randomUUID().toString();

        TransferRequest original = TransferRequestBuilder.validTransfer(
                sourceId, destId, new BigDecimal("100.00"), "USD");
        TransferRequest modified = TransferRequestBuilder.validTransfer(
                sourceId, destId, new BigDecimal("200.00"), "USD");

        apiClient.initiateTransfer(original, idempotencyKey).then().statusCode(200);

        Response conflictResponse = apiClient.initiateTransfer(modified, idempotencyKey);

        IdempotencyAssertions.assertThat(dbClient)
                .conflictResponseIsCorrect(conflictResponse);
    }

    @Test
    @DisplayName("TC-ID-05: Same key with different destination wallet returns 409 Conflict")
    void sameKeyDifferentDestination_returns409() {
        String idempotencyKey = UUID.randomUUID().toString();
        String altDestId = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(altDestId);

        TransferRequest original = TransferRequestBuilder.validTransfer(sourceId, destId);
        TransferRequest modified = TransferRequestBuilder.validTransfer(sourceId, altDestId);

        apiClient.initiateTransfer(original, idempotencyKey).then().statusCode(200);

        Response conflictResponse = apiClient.initiateTransfer(modified, idempotencyKey);

        IdempotencyAssertions.assertThat(dbClient)
                .conflictResponseIsCorrect(conflictResponse);
    }

    // ─── G3: Exactly one DB row per key ──────────────────────────────────────

    @Test
    @DisplayName("TC-ID-06: Duplicate request results in exactly one transfer row")
    void duplicateRequest_exactlyOneDbRow() {
        String idempotencyKey = UUID.randomUUID().toString();
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        apiClient.initiateTransfer(request, idempotencyKey).then().statusCode(200);
        apiClient.initiateTransfer(request, idempotencyKey);

        IdempotencyAssertions.assertThat(dbClient)
                .exactlyOneTransferPerKey(idempotencyKey);
    }

    @Test
    @DisplayName("TC-ID-07: Three duplicate requests still result in exactly one DB row")
    void tripleDuplicateRequests_exactlyOneDbRow() {
        String idempotencyKey = UUID.randomUUID().toString();
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        apiClient.initiateTransfer(request, idempotencyKey).then().statusCode(200);
        apiClient.initiateTransfer(request, idempotencyKey);
        apiClient.initiateTransfer(request, idempotencyKey);

        IdempotencyAssertions.assertThat(dbClient)
                .exactlyOneTransferPerKey(idempotencyKey);
    }

    // ─── G4: Balance mutates exactly once ────────────────────────────────────

    @Test
    @DisplayName("TC-ID-08: Duplicate request does not double-debit source wallet")
    void duplicateRequest_noDoubleDebit() {
        BigDecimal transferAmount = new BigDecimal("100.00");
        String idempotencyKey = UUID.randomUUID().toString();

        WalletBalance sourceBefore = WalletAssertions.snapshot(dbClient, sourceId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                sourceId, destId, transferAmount, "USD");

        apiClient.initiateTransfer(request, idempotencyKey).then().statusCode(200);
        apiClient.initiateTransfer(request, idempotencyKey);  // duplicate

        // Balance should reflect exactly ONE debit, not two
        WalletAssertions.assertThat(dbClient, sourceId)
                .balanceDecreasedBy(transferAmount, sourceBefore);
    }

    @Test
    @DisplayName("TC-ID-09: Duplicate request does not double-credit destination wallet")
    void duplicateRequest_noDoubleCredit() {
        BigDecimal transferAmount = new BigDecimal("100.00");
        String idempotencyKey = UUID.randomUUID().toString();

        WalletBalance destBefore = WalletAssertions.snapshot(dbClient, destId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                sourceId, destId, transferAmount, "USD");

        apiClient.initiateTransfer(request, idempotencyKey).then().statusCode(200);
        apiClient.initiateTransfer(request, idempotencyKey);  // duplicate

        // Balance should reflect exactly ONE credit, not two
        WalletAssertions.assertThat(dbClient, destId)
                .balanceIncreasedBy(transferAmount, destBefore);
    }

    // ─── G5: Key persisted in idempotency_keys table ─────────────────────────

    @Test
    @DisplayName("TC-ID-10: Successful transfer persists idempotency key in DB")
    void successfulTransfer_idempotencyKeyPersisted() {
        String idempotencyKey = UUID.randomUUID().toString();
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response response = apiClient.initiateTransfer(request, idempotencyKey);
        response.then().statusCode(200);

        IdempotencyAssertions.assertThat(dbClient)
                .keyPersistedInDb(idempotencyKey);
    }

    @Test
    @DisplayName("TC-ID-11: Idempotency key in DB maps to the correct transfer_id")
    void idempotencyKey_mapsToCorrectTransfer() {
        String idempotencyKey = UUID.randomUUID().toString();
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response response = apiClient.initiateTransfer(request, idempotencyKey);
        String transferId = response.jsonPath().getString("transfer_id");

        IdempotencyAssertions.assertThat(dbClient)
                .dbTransferMatchesOriginal(idempotencyKey, transferId);
    }

    // ─── G6: Unique key per distinct request ─────────────────────────────────

    @Test
    @DisplayName("TC-ID-12: Two requests with different keys create two independent transfers")
    void differentKeys_createIndependentTransfers() {
        String key1 = UUID.randomUUID().toString();
        String key2 = UUID.randomUUID().toString();

        TransferRequest request1 = TransferRequestBuilder.validTransfer(sourceId, destId);
        TransferRequest request2 = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response r1 = apiClient.initiateTransfer(request1, key1);
        Response r2 = apiClient.initiateTransfer(request2, key2);

        r1.then().statusCode(200);
        r2.then().statusCode(200);

        String transferId1 = r1.jsonPath().getString("transfer_id");
        String transferId2 = r2.jsonPath().getString("transfer_id");

        org.assertj.core.api.Assertions.assertThat(transferId1)
                .as("Different idempotency keys must produce different transfer_ids")
                .isNotEqualTo(transferId2);
    }
}