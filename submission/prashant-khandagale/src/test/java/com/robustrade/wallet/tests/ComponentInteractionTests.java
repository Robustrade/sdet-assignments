package com.robustrade.wallet.tests;

import com.robustrade.wallet.dto.TransferRequestDto;
import com.robustrade.wallet.support.BaseTest;
import com.robustrade.wallet.support.TestData;
import io.restassured.response.Response;
import org.testng.annotations.Test;

import java.math.BigDecimal;

import static org.testng.Assert.assertEquals;

/**
 * A single transfer touches five tables (wallets x2, transfers,
 * transfer_events, outbox_events) plus idempotency_keys when a key is
 * supplied. These tests target exactly that multi-table interaction: proving
 * writes across all of them commit together, and that a failure partway
 * through leaves NO partial state anywhere -- not a stray event row, not a
 * half-updated balance, not a claimed-but-unfinished idempotency key.
 */
public class ComponentInteractionTests extends BaseTest {

    @Test
    public void businessRuleFailureAfterWalletLock_rollsBackEverything_noPartialState() {
        // Wallets exist but have mismatched currencies -- this failure is only
        // detectable AFTER both wallets are locked inside the transaction,
        // making it a good probe for "does a late failure leave partial writes".
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("EUR", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("10.00"), "USD");
        String key = TestData.newIdempotencyKey();

        api.createTransfer(request, key).then().statusCode(400);

        // Nothing should have moved or been recorded anywhere.
        assertEquals(db.walletBalance(source), new BigDecimal("100.00"));
        assertEquals(db.walletBalance(destination), new BigDecimal("10.00"));
        assertEquals(db.totalTransferCount(), 0);
        // The idempotency claim made at the start of processing must have been
        // rolled back too -- otherwise this key would be permanently unusable.
        assertEquals(db.idempotencyRowCount(key), 0);
    }

    @Test
    public void rolledBackIdempotencyKey_canBeSuccessfullyRetried() {
        // First attempt fails a business rule after claiming the idempotency key...
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String mismatchedDestination = testData.seedWallet("EUR", new BigDecimal("10.00"));
        String key = TestData.newIdempotencyKey();

        TransferRequestDto failingRequest = TestData.transferRequest(source, mismatchedDestination,
                new BigDecimal("10.00"), "USD");
        api.createTransfer(failingRequest, key).then().statusCode(400);

        // ...then the SAME key is reused with a valid, well-formed request and
        // must be free to process normally (proves the rollback truly freed the key).
        String validDestination = testData.seedWallet("USD", new BigDecimal("5.00"));
        TransferRequestDto validRequest = TestData.transferRequest(source, validDestination,
                new BigDecimal("10.00"), "USD");

        Response response = api.createTransfer(validRequest, key);
        response.then().statusCode(200).body("status", org.hamcrest.Matchers.equalTo("COMPLETED"));
        assertEquals(db.idempotencyRowCount(key), 1);
    }

    @Test
    public void successfulTransfer_writesExactlyOneRowPerTableInvolved() {
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("20.00"), "USD");
        String key = TestData.newIdempotencyKey();

        String transferId = api.createTransfer(request, key).jsonPath().getString("transfer_id");

        assertEquals(db.transferRowCount(transferId), 1);
        assertEquals(db.transferEventCount(transferId), 2); // CREATED + COMPLETED
        assertEquals(db.outboxEventCount(transferId), 1);
        assertEquals(db.idempotencyRowCount(key), 1);
    }
}
