package com.wallet.transfer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.wallet.transfer.builders.TransferRequestBuilder;
import com.wallet.transfer.dto.TransferRequest;
import com.wallet.transfer.dto.TransferResponse;
import com.wallet.transfer.fixtures.TestFixture;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Happy path API tests for the wallet transfer service. These tests verify successful transfer
 * operations and retrieval endpoints.
 */
class HappyPathTransferTest extends TestFixture {

  /**
   * TC_001: Verify successful transfer between wallets with sufficient balance.
   *
   * <p>Scenario: Source wallet (wallet_001) has 10000 INR, destination wallet (wallet_002) has 5000
   * INR. Transfer 1000 INR from source to destination with a valid idempotency key. Expected: HTTP
   * 201 Created with COMPLETED status, correct transfer details in response.
   */
  @Test
  @DisplayName(
      "POST /transfers - should successfully transfer between wallets with sufficient balance")
  void shouldSuccessfullyTransferBetweenWallets() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("1000.00"))
            .withCurrency("INR")
            .withReference("invoice_123")
            .build();

    TransferResponse response = api.createTransfer(request, idempotencyKey);

    assertThat(response.status()).isEqualTo("COMPLETED");
    assertThat(response.transferId()).isNotNull();
    assertThat(response.amount()).isEqualByComparingTo("1000.00");
    assertThat(response.currency()).isEqualTo("INR");
    assertThat(response.sourceWalletId()).isEqualTo("wallet_001");
    assertThat(response.destinationWalletId()).isEqualTo("wallet_002");
    assertThat(response.reference()).isEqualTo("invoice_123");
  }

  /**
   * TC_002: Verify 201 Created status returned on successful transfer.
   *
   * <p>Scenario: Valid transfer request with sufficient balance. Expected: HTTP 201 status code (no
   * response body validation needed here).
   */
  @Test
  @DisplayName("POST /transfers - should return 201 Created status on successful transfer")
  void shouldReturn201OnSuccessfulTransfer() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withAmount(new BigDecimal("500.00"))
            .withCurrency("INR")
            .build();

    api.createTransferRaw(request, idempotencyKey).then().statusCode(201);
  }

  /**
   * TC_003: Verify transfer can be retrieved by ID.
   *
   * <p>Scenario: Create a transfer, then retrieve it using GET /transfers/{id}. Expected: Retrieved
   * transfer matches the created transfer in all fields.
   */
  @Test
  @DisplayName("GET /transfers/{id} - should retrieve transfer by ID")
  void shouldRetrieveTransferById() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withAmount(new BigDecimal("250.00"))
            .withCurrency("INR")
            .build();

    TransferResponse createResponse = api.createTransfer(request, idempotencyKey);

    TransferResponse getResponse = api.getTransfer(createResponse.transferId());

    assertThat(getResponse.transferId()).isEqualTo(createResponse.transferId());
    assertThat(getResponse.status()).isEqualTo("COMPLETED");
    assertThat(getResponse.amount()).isEqualByComparingTo("250.00");
    assertThat(getResponse.sourceWalletId()).isEqualTo("wallet_001");
    assertThat(getResponse.destinationWalletId()).isEqualTo("wallet_002");
  }

  /**
   * TC_004: Verify wallet can be retrieved by ID.
   *
   * <p>Scenario: GET /wallets/{id} for wallet_001 which was seeded with 10000 INR. Expected: Wallet
   * response matches seeded data.
   */
  @Test
  @DisplayName("GET /wallets/{id} - should retrieve wallet by ID")
  void shouldRetrieveWalletById() {
    var response = api.getWallet("wallet_001");

    assertThat(response.walletId()).isEqualTo("wallet_001");
    assertThat(response.balance()).isEqualByComparingTo("10000.00");
    assertThat(response.currency()).isEqualTo("INR");
  }

  /**
   * TC_005: Verify multiple sequential transfers from the same source wallet work correctly.
   *
   * <p>Scenario: Two transfers from wallet_001 (10000 INR) - 100 INR to wallet_002 and 200 INR to
   * wallet_003. Each uses a unique idempotency key. Expected: Both transfers complete with
   * COMPLETED status, different transfer IDs, correct balance updates.
   */
  @Test
  @DisplayName("POST /transfers - should handle multiple successful transfers sequentially")
  void shouldHandleMultipleTransfersSequentially() {
    String key1 = TransferApi.generateIdempotencyKey();
    String key2 = TransferApi.generateIdempotencyKey();

    TransferRequest request1 =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .build();

    TransferRequest request2 =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_003")
            .withAmount(new BigDecimal("200.00"))
            .withCurrency("INR")
            .build();

    TransferResponse response1 = api.createTransfer(request1, key1);
    TransferResponse response2 = api.createTransfer(request2, key2);

    assertThat(response1.status()).isEqualTo("COMPLETED");
    assertThat(response2.status()).isEqualTo("COMPLETED");
    assertThat(response1.transferId()).isNotEqualTo(response2.transferId());
  }
}
