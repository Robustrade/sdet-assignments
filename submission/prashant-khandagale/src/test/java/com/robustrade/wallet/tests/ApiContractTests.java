package com.robustrade.wallet.tests;

import com.robustrade.wallet.dto.TransferRequestDto;
import com.robustrade.wallet.support.BaseTest;
import com.robustrade.wallet.support.TestData;
import io.restassured.response.Response;
import org.testng.annotations.Test;

import java.math.BigDecimal;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.testng.Assert.assertNotNull;

/**
 * Covers: happy path response shape, field validation, not-found handling,
 * and idempotent replay -- all asserted purely from the HTTP response.
 * (DB-side proof that nothing extra happened lives in DatabaseVerificationTests.)
 */
public class ApiContractTests extends BaseTest {

    @Test
    public void happyPath_returnsCompletedTransferWithExpectedShape() {
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("25.00"), "USD");

        Response response = api.createTransfer(request, TestData.newIdempotencyKey());

        response.then()
                .statusCode(200)
                .body("status", equalTo("COMPLETED"))
                .body("transfer_id", notNullValue())
                .body("source_wallet_id", equalTo(source))
                .body("destination_wallet_id", equalTo(destination))
                .body("amount", equalTo(25.00f))
                .body("currency", equalTo("USD"));
    }

    @Test
    public void missingSourceWalletId_returns400() {
        TransferRequestDto request = TestData.transferRequest(null, "wallet_x", new BigDecimal("10"), "USD");
        api.createTransfer(request, null).then().statusCode(400).body("error", equalTo("VALIDATION_ERROR"));
    }

    @Test
    public void invalidCurrencyCode_returns400() {
        String source = testData.seedWallet("USD", new BigDecimal("100"));
        String destination = testData.seedWallet("USD", new BigDecimal("10"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("10"), "US");
        api.createTransfer(request, null).then().statusCode(400);
    }

    @Test
    public void zeroAmount_returns400() {
        String source = testData.seedWallet("USD", new BigDecimal("100"));
        String destination = testData.seedWallet("USD", new BigDecimal("10"));
        TransferRequestDto request = TestData.transferRequest(source, destination, BigDecimal.ZERO, "USD");
        api.createTransfer(request, null).then().statusCode(400);
    }

    @Test
    public void negativeAmount_returns400() {
        String source = testData.seedWallet("USD", new BigDecimal("100"));
        String destination = testData.seedWallet("USD", new BigDecimal("10"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("-5"), "USD");
        api.createTransfer(request, null).then().statusCode(400);
    }

    @Test
    public void sourceEqualsDestination_returns400() {
        String wallet = testData.seedWallet("USD", new BigDecimal("100"));
        TransferRequestDto request = TestData.transferRequest(wallet, wallet, new BigDecimal("10"), "USD");
        api.createTransfer(request, null).then().statusCode(400);
    }

    @Test
    public void malformedJsonBody_returns400() {
        api.createTransferRaw("{not valid json", null).then().statusCode(400);
    }

    @Test
    public void blankIdempotencyKeyHeader_returns400() {
        String source = testData.seedWallet("USD", new BigDecimal("100"));
        String destination = testData.seedWallet("USD", new BigDecimal("10"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("10"), "USD");
        api.createTransfer(request, "").then().statusCode(400);
    }

    @Test
    public void nonexistentSourceWallet_returns404() {
        TransferRequestDto request = TestData.transferRequest("wallet_does_not_exist",
                testData.seedWallet("USD", new BigDecimal("10")), new BigDecimal("5"), "USD");
        api.createTransfer(request, null).then().statusCode(404);
    }

    @Test
    public void insufficientBalance_returns200WithRejectedStatus() {
        String source = testData.seedWallet("USD", new BigDecimal("5.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("100.00"), "USD");

        api.createTransfer(request, null).then()
                .statusCode(200)
                .body("status", equalTo("REJECTED"))
                .body("rejection_reason", equalTo("INSUFFICIENT_BALANCE"));
    }

    @Test
    public void duplicateSubmission_sameKeySamePayload_returnsOriginalResultAndMarksReplayed() {
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("25.00"), "USD");
        String key = TestData.newIdempotencyKey();

        Response first = api.createTransfer(request, key);
        String firstTransferId = first.jsonPath().getString("transfer_id");

        Response second = api.createTransfer(request, key);

        second.then()
                .statusCode(first.statusCode())
                .body("transfer_id", equalTo(firstTransferId))
                .body("replayed", equalTo(true));
    }

    @Test
    public void duplicateSubmission_sameKeyDifferentPayload_returns409() {
        String source = testData.seedWallet("USD", new BigDecimal("100.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("10.00"));
        String key = TestData.newIdempotencyKey();

        TransferRequestDto original = TestData.transferRequest(source, destination, new BigDecimal("25.00"), "USD");
        api.createTransfer(original, key).then().statusCode(200);

        TransferRequestDto different = TestData.transferRequest(source, destination, new BigDecimal("99.00"), "USD");
        api.createTransfer(different, key).then().statusCode(409).body("error", equalTo("IDEMPOTENCY_KEY_REUSED"));
    }

    @Test
    public void getTransfer_unknownId_returns404() {
        api.getTransfer("does-not-exist").then().statusCode(404);
    }

    @Test
    public void getWallet_unknownId_returns404() {
        api.getWallet("does-not-exist").then().statusCode(404);
    }

    @Test
    public void getTransfer_afterCreate_matchesWhatWasCreated() {
        String source = testData.seedWallet("USD", new BigDecimal("50.00"));
        String destination = testData.seedWallet("USD", new BigDecimal("5.00"));
        TransferRequestDto request = TestData.transferRequest(source, destination, new BigDecimal("12.50"), "USD");

        String transferId = api.createTransfer(request, null).jsonPath().getString("transfer_id");
        assertNotNull(transferId);

        Response fetched = api.getTransfer(transferId);
        fetched.then().statusCode(200).body("transfer_id", equalTo(transferId)).body("status", equalTo("COMPLETED"));
    }
}
