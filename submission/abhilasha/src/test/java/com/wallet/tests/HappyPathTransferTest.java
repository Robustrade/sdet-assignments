package com.wallet.tests;

import com.wallet.assertions.TransferAssertions;
import com.wallet.assertions.WalletAssertions;
import com.wallet.base.WalletTransferTestBase;
import com.wallet.fixture.TransferRequestBuilder;
import com.wallet.fixture.WalletFixture;
import com.wallet.model.TransferRequest;
import com.wallet.model.WalletBalance;
import io.restassured.response.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

/**
 * Happy-path integration tests for the Wallet Transfer Service.
 *
 * Each test:
 *   1. Seeds isolated wallet(s) with known balances
 *   2. Submits a transfer via the API
 *   3. Asserts API response semantics
 *   4. Asserts DB state (transfer record + balance mutations)
 *   5. Asserts balance conservation invariant
 *
 * Tags: happy-path, smoke
 */
@Tag("happy-path")
@Tag("smoke")
@DisplayName("Happy Path Transfer Tests")
class HappyPathTransferTest extends WalletTransferTestBase {

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

    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("TC-HP-01: Successful transfer returns 200 with transfer_id and status=success")
    void successfulTransfer_returns200WithTransferId() {
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        TransferAssertions.assertThat(response, dbClient)
                .hasStatusCode(200)
                .hasTransferId()
                .hasResponseStatus("success")
                .hasNoFieldErrors()
                .dbRecordExists()
                .dbRecordHasStatus("success")
                .dbRecordHasAmount(new BigDecimal("100.00"))
                .dbRecordHasCurrency("USD");
    }

    @Test
    @DisplayName("TC-HP-02: Transfer debits source wallet by exact amount")
    void successfulTransfer_debitsSourceWallet() {
        BigDecimal transferAmount = new BigDecimal("250.00");
        WalletBalance sourceBefore = WalletAssertions.snapshot(dbClient, sourceId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                sourceId, destId, transferAmount, "USD");
        apiClient.initiateTransfer(request);

        WalletAssertions.assertThat(dbClient, sourceId)
                .balanceDecreasedBy(transferAmount, sourceBefore)
                .hasNonNegativeBalance();
    }

    @Test
    @DisplayName("TC-HP-03: Transfer credits destination wallet by exact amount")
    void successfulTransfer_creditsDestinationWallet() {
        BigDecimal transferAmount = new BigDecimal("250.00");
        WalletBalance destBefore = WalletAssertions.snapshot(dbClient, destId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                sourceId, destId, transferAmount, "USD");
        apiClient.initiateTransfer(request);

        WalletAssertions.assertThat(dbClient, destId)
                .balanceIncreasedBy(transferAmount, destBefore);
    }

    @Test
    @DisplayName("TC-HP-04: Balance conservation — no money created or destroyed")
    void successfulTransfer_balanceConservation() {
        BigDecimal transferAmount = new BigDecimal("123.45");

        WalletBalance sourceBefore = WalletAssertions.snapshot(dbClient, sourceId);
        WalletBalance destBefore   = WalletAssertions.snapshot(dbClient, destId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                sourceId, destId, transferAmount, "USD");
        apiClient.initiateTransfer(request);

        WalletBalance sourceAfter = WalletAssertions.snapshot(dbClient, sourceId);
        WalletBalance destAfter   = WalletAssertions.snapshot(dbClient, destId);

        WalletAssertions.assertBalanceConservation(sourceBefore, sourceAfter, destBefore, destAfter);
    }

    @Test
    @DisplayName("TC-HP-05: Transfer with optional reference field is persisted")
    void successfulTransfer_referencePersistedInDb() {
        String reference = "INVOICE-2024-00123";
        TransferRequest request = TransferRequestBuilder.validTransferWithReference(
                sourceId, destId, reference);

        Response response = apiClient.initiateTransfer(request);

        TransferAssertions.assertThat(response, dbClient)
                .hasStatusCode(200)
                .dbRecordHasReference(reference);
    }

    @Test
    @DisplayName("TC-HP-06: Transfer uses exact source balance (boundary — zero remainder)")
    void successfulTransfer_exactBalance_leavesZeroBalance() {
        BigDecimal exactBalance = new BigDecimal("1000.00");
        String fullSourceId = walletFixture.createExactBalanceWallet(exactBalance, "USD");
        String emptyDestId  = walletFixture.createEmptyWallet("USD");
        testWalletIds.add(fullSourceId);
        testWalletIds.add(emptyDestId);

        TransferRequest request = TransferRequestBuilder.validTransfer(
                fullSourceId, emptyDestId, exactBalance, "USD");

        Response response = apiClient.initiateTransfer(request);

        TransferAssertions.assertThat(response, dbClient)
                .hasStatusCode(200)
                .dbRecordHasStatus("success");

        WalletAssertions.assertThat(dbClient, fullSourceId)
                .hasBalance(BigDecimal.ZERO);

        WalletAssertions.assertThat(dbClient, emptyDestId)
                .hasBalance(exactBalance);
    }

    @Test
    @DisplayName("TC-HP-07: Minimum valid transfer amount (0.01) succeeds")
    void successfulTransfer_minimumAmount() {
        TransferRequest request = TransferRequestBuilder.minimumAmount(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        TransferAssertions.assertThat(response, dbClient)
                .hasStatusCode(200)
                .dbRecordHasStatus("success")
                .dbRecordHasAmount(new BigDecimal("0.01"));
    }

    @Test
    @DisplayName("TC-HP-08: Audit trail — transfer events created in correct sequence")
    void successfulTransfer_auditTrailCreated() {
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        TransferAssertions.assertThat(response, dbClient)
                .hasStatusCode(200)
                .dbHasAtLeastOneAuditEvent();
    }

    @Test
    @DisplayName("TC-HP-09: Outbox event published for downstream consumers")
    void successfulTransfer_outboxEventCreated() {
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);

        Response response = apiClient.initiateTransfer(request);

        TransferAssertions.assertThat(response, dbClient)
                .hasStatusCode(200)
                .dbHasOutboxEvent();
    }

    @Test
    @DisplayName("TC-HP-10: Subsequent GET /transfers/{id} returns same transfer data")
    void successfulTransfer_getTransferReturnsConsistentData() {
        TransferRequest request = TransferRequestBuilder.validTransfer(sourceId, destId);
        Response createResponse = apiClient.initiateTransfer(request);

        String transferId = createResponse.jsonPath().getString("transfer_id");
        Response getResponse = apiClient.getTransfer(transferId);

        getResponse.then().statusCode(200);

        org.assertj.core.api.Assertions.assertThat(getResponse.jsonPath().getString("transfer_id"))
                .as("GET /transfers/{id} returned different transfer_id")
                .isEqualTo(transferId);

        org.assertj.core.api.Assertions.assertThat(getResponse.jsonPath().getString("status"))
                .as("GET /transfers/{id} returned different status")
                .isEqualTo(createResponse.jsonPath().getString("status"));
    }

    @Test
    @DisplayName("TC-HP-11: GET /wallets/{id} balance matches DB balance after transfer")
    void successfulTransfer_apiWalletBalanceMatchesDb() {
        BigDecimal transferAmount = new BigDecimal("150.00");
        TransferRequest request = TransferRequestBuilder.validTransfer(
                sourceId, destId, transferAmount, "USD");

        apiClient.initiateTransfer(request).then().statusCode(200);

        // Source wallet — API balance must match DB balance
        Response sourceWalletResponse = apiClient.getWallet(sourceId);
        sourceWalletResponse.then().statusCode(200);

        BigDecimal apiSourceBalance = sourceWalletResponse.jsonPath().getBigDecimal("balance");
        BigDecimal dbSourceBalance  = dbClient.getWalletBalance(sourceId).getBalance();

        org.assertj.core.api.Assertions.assertThat(apiSourceBalance.stripTrailingZeros())
                .as("API-visible source balance %s does not match DB balance %s",
                        apiSourceBalance, dbSourceBalance)
                .isEqualTo(dbSourceBalance.stripTrailingZeros());

        // Destination wallet — API balance must match DB balance
        Response destWalletResponse = apiClient.getWallet(destId);
        destWalletResponse.then().statusCode(200);

        BigDecimal apiDestBalance = destWalletResponse.jsonPath().getBigDecimal("balance");
        BigDecimal dbDestBalance  = dbClient.getWalletBalance(destId).getBalance();

        org.assertj.core.api.Assertions.assertThat(apiDestBalance.stripTrailingZeros())
                .as("API-visible destination balance %s does not match DB balance %s",
                        apiDestBalance, dbDestBalance)
                .isEqualTo(dbDestBalance.stripTrailingZeros());
    }
}
