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
 * API contract tests — mostly just checking HTTP status codes and response shapes.
 * Not verifying DB state here; that's for the e2e and idempotency tests.
 * These run fast and catch basic stuff like missing fields, wrong codes, etc.
 */
@DisplayName("Transfer API — Contract & Validation Tests")
@TestMethodOrder(MethodOrderer.DisplayName.class)
class TransferApiTests extends BaseIntegrationTest {

    // -------------------------------------------------------------------------
    //  Happy path — shape of successful response
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("[API-01] POST /transfers — 201 Created with correct response shape")
    void createTransfer_returns201WithExpectedShape() {
        // fresh key for this test — don't want any leftovers from a previous run
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer()
                .from(ALICE).to(BOB).amount(100).currency("AED").reference("ref-api-01")
                .build();

        // send the transfer and check we get back what we expect
        assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated()
                .hasTransferId()
                .hasStatus("COMPLETED")
                .hasBodyField("sourceWalletId",      ALICE)
                .hasBodyField("destinationWalletId", BOB)
                .hasBodyField("currency",            "AED");

        // track so cleanup can remove it after the test
        cleanup.trackIdempotencyKey(key);
    }

    @Test
    @DisplayName("[API-02] GET /transfers/{id} — 200 OK for existing transfer")
    void getTransfer_existingId_returns200() {
        String key = newIdempotencyKey();
        TransferRequest req = aTransfer().from(ALICE).to(BOB).amount(50).build();

        // first create a transfer so we have a real id to look up
        String transferId = assertThatResponse(transferClient.createTransfer(req, key))
                .isCreated()
                .extractTransferId();

        // now GET it and make sure the data matches
        assertThatResponse(transferClient.getTransfer(transferId))
                .isOk()
                .hasStatus("COMPLETED")
                .transferIdEquals(transferId);

        cleanup.trackIdempotencyKey(key);
    }

    @Test
    @DisplayName("[API-03] GET /transfers/{id} — 404 Not Found for unknown id")
    void getTransfer_unknownId_returns404() {
        // just some random string that definitely won't be in DB
        assertThatResponse(transferClient.getTransfer("non-existent-id"))
                .isNotFound();
    }

    @Test
    @DisplayName("[API-04] GET /wallets/{id} — 200 OK with correct wallet shape")
    void getWallet_existingId_returns200() {
        // Alice is seeded before every test, so this should always work
        assertThatResponse(walletClient.getWallet(ALICE))
                .isOk()
                .hasBodyField("id", ALICE)
                .hasBodyField("currency", "AED");
    }

    @Test
    @DisplayName("[API-05] GET /wallets/{id} — 404 Not Found for unknown wallet")
    void getWallet_unknownId_returns404() {
        // "wallet_ghost" doesn't exist — expecting a 404 here
        assertThatResponse(walletClient.getWallet("wallet_ghost"))
                .isNotFound();
    }

    // -------------------------------------------------------------------------
    //  Validation failures — 400 Bad Request
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("[API-06] POST /transfers — 400 when source_wallet_id is missing")
    void createTransfer_missingSourceWalletId_returns400() {
        // null source wallet — service should reject this immediately
        TransferRequest req = aTransfer().withNullSource().to(BOB).amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("source_wallet_id");
    }

    @Test
    @DisplayName("[API-07] POST /transfers — 400 when destination_wallet_id is missing")
    void createTransfer_missingDestinationWalletId_returns400() {
        // no destination — can't transfer to thin air
        TransferRequest req = aTransfer().from(ALICE).withNullDestination().amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("destination_wallet_id");
    }

    @Test
    @DisplayName("[API-08] POST /transfers — 400 when amount is zero")
    void createTransfer_zeroAmount_returns400() {
        // zero amount is pointless — should be a validation error
        TransferRequest req = aTransfer().from(ALICE).to(BOB).amount(0).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("amount");
    }

    @Test
    @DisplayName("[API-09] POST /transfers — 400 when amount is negative")
    void createTransfer_negativeAmount_returns400() {
        // negative amounts make no sense for a transfer
        TransferRequest req = aTransfer().from(ALICE).to(BOB).amount(-500).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("amount");
    }

    @Test
    @DisplayName("[API-10] POST /transfers — 400 when source == destination wallet")
    void createTransfer_selfTransfer_returns400() {
        // sending money to yourself — the service says no
        TransferRequest req = aTransfer().from(ALICE).withSameSourceAndDestination().amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("different");
    }

    @Test
    @DisplayName("[API-11] POST /transfers — 400 when currency is unsupported")
    void createTransfer_unsupportedCurrency_returns400() {
        // XYZ is not a real currency we support
        TransferRequest req = aTransfer().from(ALICE).to(BOB).currency("XYZ").amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest()
                .hasErrorMessageContaining("currency");
    }

    @Test
    @DisplayName("[API-12] POST /transfers — 400 when currency is missing")
    void createTransfer_missingCurrency_returns400() {
        // null currency — also a bad request
        TransferRequest req = aTransfer().from(ALICE).to(BOB).currency(null).amount(100).build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isBadRequest();
    }

    // -------------------------------------------------------------------------
    //  Insufficient balance — 422 Unprocessable Entity
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("[API-13] POST /transfers — 422 when source has insufficient balance")
    void createTransfer_insufficientBalance_returns422() {
        // EMPTY wallet starts with 0 balance — even 1 AED is too much
        TransferRequest req = aTransfer()
                .from(EMPTY).to(BOB).amount(1).currency("AED").build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isUnprocessableEntity()
                .hasErrorMessageContaining("insufficient");
    }

    @Test
    @DisplayName("[API-14] POST /transfers — 422 when amount exceeds source balance")
    void createTransfer_amountExceedsBalance_returns422() {
        // CHARLIE has 1000; try to send 5000 — should fail with 422
        TransferRequest req = aTransfer()
                .from(CHARLIE).to(BOB).amount(5_000).currency("AED").build();

        assertThatResponse(transferClient.createTransfer(req, newIdempotencyKey()))
                .isUnprocessableEntity();
    }
}

