package com.wallet.tests.api;

import com.wallet.builders.TransferRequestBuilder;
import com.wallet.model.TransferRequest;
import com.wallet.tests.BaseIntegrationTest;
import org.junit.jupiter.api.*;

import java.math.BigDecimal;

import static com.wallet.assertions.ApiAssertions.assertThatResponse;
import static com.wallet.builders.TransferRequestBuilder.aTransfer;
import static com.wallet.fixtures.TestDataSeeder.*;

/**
 * API CONTRACT TESTS
 *
 * Validates:
 *  - HTTP status codes
 *  - Response payload shape
 *  - Validation error responses
 *  - Not-found scenarios
 *
 * These are "black-box" API tests — they do not assume knowledge of internal state.
 * DB checks belong in e2e or idempotency tests.
 */
@DisplayName("Transfer API — Contract & Validation Tests")
@TestMethodOrder(MethodOrderer.DisplayName.class)
class TransferApiTests extends BaseIntegrationTest {

    // ─────────────────────────────────────────────────────────────────────────
    //  Happy path — shape of successful response
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[API-01] POST /transfers — 201 Created with correct response shape")
    void createTransfer_returns201WithExpectedShape() {
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(100).currency("AED").reference("ref-api-01")
                .build();

        assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated()
                .hasTransferId()
                .hasStatus("COMPLETED")
                .hasBodyField("sourceWalletId",      ALICE)
                .hasBodyField("destinationWalletId", BOB)
                .hasBodyField("currency",            "AED");

        cleanup.trackIdempotencyKey(key);
    }

    @Test
    @DisplayName("[API-02] GET /transfers/{id} — 200 OK for existing transfer")
    void getTransfer_existingId_returns200() {
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer().from(ALICE).to(BOB).amount(50).build();

        String transferId = assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated()
                .extractTransferId();

        assertThatResponse(transferClient.getTransfer(transferId))
                .isOk()
                .hasStatus("COMPLETED")
                .transferIdEquals(transferId);

        cleanup.trackIdempotencyKey(key);
    }

    @Test
    @DisplayName("[API-03] GET /transfers/{id} — 404 Not Found for unknown id")
    void getTransfer_unknownId_returns404() {
        assertThatResponse(transferClient.getTransfer("non-existent-id"))
                .isNotFound();
    }

    @Test
    @DisplayName("[API-04] GET /wallets/{id} — 200 OK with correct wallet shape")
    void getWallet_existingId_returns200() {
        assertThatResponse(walletClient.getWallet(ALICE))
                .isOk()
                .hasBodyField("id", ALICE)
                .hasBodyField("currency", "AED");
    }

    @Test
    @DisplayName("[API-05] GET /wallets/{id} — 404 Not Found for unknown wallet")
    void getWallet_unknownId_returns404() {
        assertThatResponse(walletClient.getWallet("wallet_ghost"))
                .isNotFound();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Validation failures — 400 Bad Request
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[API-06] POST /transfers — 400 when source_wallet_id is missing")
    void createTransfer_missingSourceWalletId_returns400() {
        TransferRequest req = aTransfer().withNullSource().to(BOB).amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("source_wallet_id");
    }

    @Test
    @DisplayName("[API-07] POST /transfers — 400 when destination_wallet_id is missing")
    void createTransfer_missingDestinationWalletId_returns400() {
        TransferRequest req = aTransfer().from(ALICE).withNullDestination().amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("destination_wallet_id");
    }

    @Test
    @DisplayName("[API-08] POST /transfers — 400 when amount is zero")
    void createTransfer_zeroAmount_returns400() {
        TransferRequest req = aTransfer().from(ALICE).to(BOB).amount(0).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("amount");
    }

    @Test
    @DisplayName("[API-09] POST /transfers — 400 when amount is negative")
    void createTransfer_negativeAmount_returns400() {
        TransferRequest req = aTransfer().from(ALICE).to(BOB).amount(-500).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("amount");
    }

    @Test
    @DisplayName("[API-10] POST /transfers — 400 when source == destination wallet")
    void createTransfer_selfTransfer_returns400() {
        TransferRequest req = aTransfer().from(ALICE).withSameSourceAndDestination().amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("different");
    }

    @Test
    @DisplayName("[API-11] POST /transfers — 400 when currency is unsupported")
    void createTransfer_unsupportedCurrency_returns400() {
        TransferRequest req = aTransfer().from(ALICE).to(BOB).currency("XYZ").amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("currency");
    }

    @Test
    @DisplayName("[API-12] POST /transfers — 400 when currency is missing")
    void createTransfer_missingCurrency_returns400() {
        TransferRequest req = aTransfer().from(ALICE).to(BOB).currency(null).amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Insufficient balance — 422 Unprocessable Entity
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("[API-13] POST /transfers — 422 when source has insufficient balance")
    void createTransfer_insufficientBalance_returns422() {
        TransferRequest req = aTransfer()
                .from(EMPTY).to(BOB).amount(1).currency("AED").build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isUnprocessableEntity()
                .hasErrorMessageContaining("insufficient");
    }

    @Test
    @DisplayName("[API-14] POST /transfers — 422 when amount exceeds source balance")
    void createTransfer_amountExceedsBalance_returns422() {
        // CHARLIE has 1000; try to send 5000
        TransferRequest req = aTransfer()
                .from(CHARLIE).to(BOB).amount(5_000).currency("AED").build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isUnprocessableEntity();
    }
}

