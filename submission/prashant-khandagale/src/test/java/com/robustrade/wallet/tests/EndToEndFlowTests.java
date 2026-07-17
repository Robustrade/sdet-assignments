package com.robustrade.wallet.tests;

import com.robustrade.wallet.dto.TransferRequestDto;
import com.robustrade.wallet.support.BaseTest;
import com.robustrade.wallet.support.TestData;
import io.restassured.response.Response;
import org.testng.annotations.Test;

import java.math.BigDecimal;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertNotNull;

/**
 * These tests deliberately walk the WHOLE path for one scenario at a time:
 * API request -> DB-persisted transfer -> wallet balances -> audit events ->
 * outbox -> GET endpoints reflecting the same state. Narrower, single-layer
 * checks live in ApiContractTests / DatabaseVerificationTests; this class is
 * about proving the layers agree with each other end to end.
 */
public class EndToEndFlowTests extends BaseTest {

    @Test
    public void successfulTransfer_isConsistentAcrossApiDbAuditAndOutbox() {
        String source = testData.seedWallet("USD", new BigDecimal("200.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("50.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("75.00"), "USD");

        // 1. API accepts the request and reports COMPLETED.
        Response createResponse = api.createTransfer(request, TestData.newIdempotencyKey());
        createResponse.then().statusCode(200);
        String transferId = createResponse.jsonPath().getString("transfer_id");
        assertNotNull(transferId);
        assertEquals(createResponse.jsonPath().getString("status"), "COMPLETED");

        // 2. Wallet balances on disk reflect the movement.
        assertEquals(db.walletBalance(source), new BigDecimal("125.0000"));
        assertEquals(db.walletBalance(destination), new BigDecimal("125.0000"));

        // 3. Exactly one transfer row, status COMPLETED.
        assertEquals(db.transferRowCount(transferId), 1);
        assertEquals(db.transferStatus(transferId), "COMPLETED");

        // 4. An audit trail exists (created + completed events).
        assertEquals(db.transferEventCount(transferId), 2);

        // 5. Exactly one outbox event was published for downstream systems.
        assertEquals(db.outboxEventCount(transferId), 1);
        assertEquals(db.outboxEventCountByStatus(transferId, "PUBLISHED"), 1);

        // 6. GET /transfers/{id} reports the same thing the DB has.
        api.getTransfer(transferId).then()
                .statusCode(200)
                .body("status", org.hamcrest.Matchers.equalTo("COMPLETED"))
                .body("transfer_id", org.hamcrest.Matchers.equalTo(transferId));

        // 7. GET /wallets/{id} reports the same balances the DB has.
        BigDecimal sourceBalance = new BigDecimal(api.getWallet(source).jsonPath().getString("balance"));
        BigDecimal destinationBalance = new BigDecimal(api.getWallet(destination).jsonPath().getString("balance"));
        assertEquals(sourceBalance.compareTo(new BigDecimal("125.0000")), 0);
        assertEquals(destinationBalance.compareTo(new BigDecimal("125.0000")), 0);
    }

    @Test
    public void rejectedTransfer_isConsistentAcrossApiDbAndAudit_withNoOutboxEvent() {
        String source = testData.seedWallet("USD", new BigDecimal("10.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("0.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("999.00"), "USD");

        Response createResponse = api.createTransfer(request, null);
        createResponse.then().statusCode(200).body("status", org.hamcrest.Matchers.equalTo("REJECTED"));
        String transferId = createResponse.jsonPath().getString("transfer_id");

        // No money moved.
        assertEquals(db.walletBalance(source), new BigDecimal("10.00"));
        assertEquals(db.walletBalance(destination), new BigDecimal("0.00"));

        // But the attempt itself is on record for audit purposes.
        assertEquals(db.transferStatus(transferId), "REJECTED");
        assertEquals(db.transferEventCount(transferId), 1);

        // Nothing to tell downstream systems -- no outbox row for a rejected transfer.
        assertEquals(db.outboxEventCount(transferId), 0);

        api.getTransfer(transferId).then()
                .statusCode(200)
                .body("status", org.hamcrest.Matchers.equalTo("REJECTED"))
                .body("rejection_reason", org.hamcrest.Matchers.equalTo("INSUFFICIENT_BALANCE"));
    }
}
