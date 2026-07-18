package com.wallet.tests;

import com.wallet.assertions.TransferAssertions;
import com.wallet.assertions.WalletAssertions;
import com.wallet.base.WalletTransferTestBase;
import com.wallet.fixture.TransferRequestBuilder;
import com.wallet.fixture.WalletFixture;
import com.wallet.model.TransferRequest;
import com.wallet.model.WalletBalance;
import io.restassured.response.Response;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Validation and business-rule rejection tests.
 *
 * Covers:
 *   - Required field validation (400 / 422)
 *   - Business rule violations (insufficient balance, same wallet, non-existent wallet)
 *   - Currency format validation
 *   - Negative/zero amount rejection
 *   - Wallet isolation: no balance mutation on rejected transfers
 */
@Tag("validation")
@DisplayName("Transfer Validation & Rejection Tests")
class ValidationFailureTest extends WalletTransferTestBase {

    private String sourceId;
    private String destId;

    @BeforeEach
    void seedWallets() {
        WalletFixture.WalletPair pair = walletFixture.createDefaultUsdPair();
        sourceId = pair.sourceId();
        destId   = pair.destinationId();
        testWalletIds.add(sourceId);
        testWalletIds.add(destId);
    }

    // ─── Required Fields ──────────────────────────────────────────────────────

    @Test
    @DisplayName("TC-VF-01: Missing source_wallet_id returns 422 with field error")
    void missingSourceWalletId_returns422() {
        TransferRequest request = TransferRequestBuilder.missingSourceWallet(destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
        TransferAssertions.assertThat(response, dbClient)
                .hasFieldError("source_wallet_id");
    }

    @Test
    @DisplayName("TC-VF-02: Missing destination_wallet_id returns 422 with field error")
    void missingDestinationWalletId_returns422() {
        TransferRequest request = TransferRequestBuilder.missingDestinationWallet(sourceId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
        TransferAssertions.assertThat(response, dbClient)
                .hasFieldError("destination_wallet_id");
    }

    @Test
    @DisplayName("TC-VF-03: Missing amount returns 422 with field error")
    void missingAmount_returns422() {
        TransferRequest request = TransferRequestBuilder.missingAmount(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
        TransferAssertions.assertThat(response, dbClient)
                .hasFieldError("amount");
    }

    @Test
    @DisplayName("TC-VF-04: Missing currency returns 422 with field error")
    void missingCurrency_returns422() {
        TransferRequest request = TransferRequestBuilder.missingCurrency(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
        TransferAssertions.assertThat(response, dbClient)
                .hasFieldError("currency");
    }

    // ─── Amount Validation ────────────────────────────────────────────────────

    @Test
    @DisplayName("TC-VF-05: Zero amount returns 422")
    void zeroAmount_returns422() {
        TransferRequest request = TransferRequestBuilder.zeroAmount(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
    }

    @Test
    @DisplayName("TC-VF-06: Negative amount returns 422")
    void negativeAmount_returns422() {
        TransferRequest request = TransferRequestBuilder.negativeAmount(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
    }

    @Test
    @DisplayName("TC-VF-07: High-precision amount (5 decimal places — 100.12345) returns 422 with field error")
    void highPrecisionAmount_returns422() {
        TransferRequest request = TransferRequestBuilder.highPrecisionAmount(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
        TransferAssertions.assertThat(response, dbClient)
                .hasFieldError("amount");
    }

    // ─── Currency Validation ──────────────────────────────────────────────────

    @Test
    @DisplayName("TC-VF-08: Invalid currency code (>3 chars) returns 422")
    void invalidCurrencyCode_returns422() {
        TransferRequest request = TransferRequestBuilder.invalidCurrencyCode(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
        TransferAssertions.assertThat(response, dbClient)
                .hasFieldError("currency");
    }

    @Test
    @DisplayName("TC-VF-09: Lowercase currency code returns 422")
    void lowercaseCurrencyCode_returns422() {
        TransferRequest request = TransferRequestBuilder.lowercaseCurrency(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
    }

    @ParameterizedTest(name = "currency=''{0}'' should return 422")
    @CsvSource({
            "US",       // too short
            "USDD",     // too long
            "123",      // numeric
            "US1",      // mixed
            " USD",     // leading space
            "USD ",     // trailing space
    })
    @DisplayName("TC-VF-10: Malformed currency codes return 422")
    void malformedCurrencyCodes_return422(String currency) {
        TransferRequest request = TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .currency(currency)
                .build();

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
    }

    // ─── Business Rules ───────────────────────────────────────────────────────

    @Test
    @DisplayName("TC-VF-11: Insufficient balance returns 422 — source balance unchanged")
    void insufficientBalance_returns422_sourceBalanceUnchanged() {
        BigDecimal initialBalance = new BigDecimal("50.00");
        String poorSourceId = walletFixture.createFundedWallet("USD", initialBalance);
        testWalletIds.add(poorSourceId);

        WalletBalance balanceBefore = WalletAssertions.snapshot(dbClient, poorSourceId);
        TransferRequest request = TransferRequestBuilder.exceedingBalance(
                poorSourceId, destId, initialBalance);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);

        WalletAssertions.assertThat(dbClient, poorSourceId)
                .balanceUnchanged(balanceBefore);
    }

    @Test
    @DisplayName("TC-VF-12: Transfer from empty wallet returns 422")
    void emptyWallet_returns422() {
        String emptySourceId = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(emptySourceId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                emptySourceId, destId, new BigDecimal("0.01"), "USD");

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
    }

    @Test
    @DisplayName("TC-VF-13: Same source and destination wallet returns 422")
    void sameSourceAndDestination_returns422() {
        TransferRequest request = TransferRequestBuilder.sameSourceAndDestination(sourceId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
    }

    @Test
    @DisplayName("TC-VF-14: Non-existent source wallet returns 404")
    void nonExistentSourceWallet_returns404() {
        TransferRequest request = TransferRequestBuilder.nonExistentSourceWallet(destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(404);
    }

    @Test
    @DisplayName("TC-VF-15: Non-existent destination wallet returns 404")
    void nonExistentDestinationWallet_returns404() {
        TransferRequest request = TransferRequestBuilder.nonExistentDestinationWallet(sourceId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(404);
    }

    @Test
    @DisplayName("TC-VF-16: Invalid UUID format for wallet_id returns 422")
    void invalidWalletIdFormat_returns422() {
        TransferRequest request = TransferRequestBuilder.invalidWalletIdFormat(destId);

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
    }

    @Test
    @DisplayName("TC-VF-17: Currency mismatch between request and source wallet returns 422")
    void currencyMismatch_returns422() {
        String gbpSourceId = walletFixture.createFundedWallet("GBP", new BigDecimal("500.00"));
        testWalletIds.add(gbpSourceId);

        TransferRequest request = TransferRequestBuilder.currencyMismatch(
                gbpSourceId, destId, "GBP", "USD");

        Response response = apiClient.initiateTransfer(request);

        response.then().statusCode(422);
    }

    // ─── Malformed Payloads ───────────────────────────────────────────────────

    @Test
    @DisplayName("TC-VF-18: Empty JSON body returns 400")
    void emptyBody_returns400() {
        Response response = apiClient.initiateTransferRaw("{}", UUID.randomUUID().toString());

        response.then().statusCode(400);
    }

    @Test
    @DisplayName("TC-VF-19: Non-JSON body returns 400")
    void nonJsonBody_returns400() {
        Response response = apiClient.initiateTransferRaw("this is not json", UUID.randomUUID().toString());

        response.then().statusCode(400);
    }

    @Test
    @DisplayName("TC-VF-20: No idempotency key header returns 400")
    void noIdempotencyKey_returns400() {
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response response = apiClient.initiateTransferWithoutIdempotencyKey(request);

        response.then().statusCode(400);
    }

    // ─── Balance invariant: failed transfers must not mutate balances ─────────

    @Test
    @DisplayName("TC-VF-21: Failed transfers leave both wallets unchanged")
    void failedTransfer_noBalanceMutation() {
        WalletBalance sourceBefore = WalletAssertions.snapshot(dbClient, sourceId);
        WalletBalance destBefore   = WalletAssertions.snapshot(dbClient, destId);

        // Attempt transfer that will fail (amount > balance)
        TransferRequest request = TransferRequestBuilder.exceedingBalance(
                sourceId, destId, new BigDecimal("1000.00"));
        apiClient.initiateTransfer(request);

        WalletAssertions.assertThat(dbClient, sourceId).balanceUnchanged(sourceBefore);
        WalletAssertions.assertThat(dbClient, destId).balanceUnchanged(destBefore);
    }
}