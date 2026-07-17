package com.robustrade.wallet.tests;

import com.robustrade.wallet.dto.TransferRequestDto;
import com.robustrade.wallet.support.BaseTest;
import com.robustrade.wallet.support.TestData;
import org.testng.annotations.Test;

import java.math.BigDecimal;

import static org.testng.Assert.assertEquals;

/**
 * These tests don't just check the HTTP response -- they open a separate
 * JDBC connection and query the tables directly, proving the persisted
 * state actually matches what the API claims happened.
 */
public class DatabaseVerificationTests extends BaseTest {

    @Test
    public void completedTransfer_debitsSourceAndCreditsDestinationExactly() {
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("30.00"), "USD");

        api.createTransfer(request, null).then().statusCode(200);

        assertEquals(db.walletBalance(source), new BigDecimal("70.0000"));
        assertEquals(db.walletBalance(destination), new BigDecimal("40.0000"));
    }

    @Test
    public void completedTransfer_isPersistedWithCorrectStatus() {
        String source = testData.seedWallet("USD", new BigDecimal("50.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("5.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("20.00"), "USD");

        String transferId = api.createTransfer(request, null).jsonPath().getString("transfer_id");

        assertEquals(db.transferRowCount(transferId), 1);
        assertEquals(db.transferStatus(transferId), "COMPLETED");
    }

    @Test
    public void rejectedTransfer_doesNotMutateEitherWalletBalance() {
        String source = testData.seedWallet("USD", new BigDecimal("5.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("500.00"), "USD");

        api.createTransfer(request, null).then().statusCode(200);

        // Balances must be untouched -- a rejected transfer is a no-op on money.
        assertEquals(db.walletBalance(source), new BigDecimal("5.00"));
        assertEquals(db.walletBalance(destination), new BigDecimal("10.00"));
    }

    @Test
    public void rejectedTransfer_isStillPersistedForAudit() {
        String source = testData.seedWallet("USD", new BigDecimal("5.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("500.00"), "USD");

        String transferId = api.createTransfer(request, null).jsonPath().getString("transfer_id");

        assertEquals(db.transferRowCount(transferId), 1);
        assertEquals(db.transferStatus(transferId), "REJECTED");
    }

    @Test
    public void validationFailure_neverCreatesATransferRow() {
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(null, destination, new BigDecimal("5.00"), "USD");

        api.createTransfer(request, null).then().statusCode(400);

        // Request was rejected before any wallet lookup happened -- confirm
        // no transfer row was created at all (this test class runs against a
        // freshly wiped DB per @BeforeClass, so a total count of 0 is a valid,
        // non-tautological assertion here).
        assertEquals(db.totalTransferCount(), 0);
    }

    @Test
    public void idempotencyKey_isPersistedExactlyOnceAfterASuccessfulCall() {
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("15.00"), "USD");
        String key = TestData.newIdempotencyKey();

        api.createTransfer(request, key).then().statusCode(200);
        api.createTransfer(request, key).then().statusCode(200); // replay

        // Exactly one idempotency row regardless of how many times the client retried.
        assertEquals(db.idempotencyRowCount(key), 1);
    }

    @Test
    public void duplicateSubmission_neverDebitsTheWalletTwice() {
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("40.00"), "USD");
        String key = TestData.newIdempotencyKey();

        api.createTransfer(request, key);
        api.createTransfer(request, key);
        api.createTransfer(request, key);

        // Three identical submissions, but the wallet should only have been
        // debited once -- this is the core idempotency guarantee.
        assertEquals(db.walletBalance(source), new BigDecimal("60.0000"));
        assertEquals(db.walletBalance(destination), new BigDecimal("50.0000"));
    }
}
