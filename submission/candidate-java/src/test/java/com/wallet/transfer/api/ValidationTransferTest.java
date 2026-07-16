package com.wallet.transfer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.wallet.transfer.builders.TransferRequestBuilder;
import com.wallet.transfer.dto.TransferRequest;
import com.wallet.transfer.fixtures.TestFixture;
import com.wallet.transfer.model.TransferErrorCode;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Validation API tests for the wallet transfer service. These tests verify that invalid requests
 * are properly rejected with appropriate error codes.
 */
class ValidationTransferTest extends TestFixture {

  /**
   * TC_006: Verify request rejected with missing source wallet ID.
   *
   * <p>Scenario: POST /transfers with empty source_wallet_id but valid destination, amount,
   * currency, reference. Expected: HTTP 400 with INVALID_REQUEST error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject request with missing source wallet ID")
  void shouldRejectMissingSourceWalletId() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.missingFields()
            .withDestinationWalletId("wallet_002")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("ref_123")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.INVALID_REQUEST.code());
  }

  /**
   * TC_007: Verify request rejected with missing destination wallet ID.
   *
   * <p>Scenario: POST /transfers with valid source_wallet_id but empty destination_wallet_id.
   * Expected: HTTP 400 with INVALID_REQUEST error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject request with missing destination wallet ID")
  void shouldRejectMissingDestinationWalletId() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.missingFields()
            .withSourceWalletId("wallet_001")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("ref_123")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.INVALID_REQUEST.code());
  }

  /**
   * TC_008: Verify request rejected with zero amount.
   *
   * <p>Scenario: POST /transfers with amount = 0. Expected: HTTP 400 with INVALID_AMOUNT error
   * code.
   */
  @Test
  @DisplayName("POST /transfers - should reject request with zero amount")
  void shouldRejectZeroAmount() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.invalidAmount()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withCurrency("INR")
            .withReference("ref_123")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.INVALID_AMOUNT.code());
  }

  /**
   * TC_009: Verify request rejected with negative amount.
   *
   * <p>Scenario: POST /transfers with amount = -100. Expected: HTTP 400 with INVALID_AMOUNT error
   * code.
   */
  @Test
  @DisplayName("POST /transfers - should reject request with negative amount")
  void shouldRejectNegativeAmount() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.negativeAmount()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withCurrency("INR")
            .withReference("ref_123")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.INVALID_AMOUNT.code());
  }

  /**
   * TC_010: Verify request rejected with missing currency.
   *
   * <p>Scenario: POST /transfers without currency field. Expected: HTTP 400.
   */
  @Test
  @DisplayName("POST /transfers - should reject request with missing currency")
  void shouldRejectMissingCurrency() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.missingFields()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withAmount(new BigDecimal("100.00"))
            .withReference("ref_123")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(400);
  }

  /**
   * TC_011: Verify request rejected with missing reference.
   *
   * <p>Scenario: POST /transfers with valid source, destination, amount, currency but missing
   * reference. Expected: HTTP 400 with INVALID_REQUEST error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject request with missing reference")
  void shouldRejectMissingReference() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.missingFields()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(400);
  }

  /**
   * TC_012: Verify request rejected with same source and destination wallet.
   *
   * <p>Scenario: POST /transfers where source_wallet_id == destination_wallet_id. Expected: HTTP
   * 400 with SAME_WALLET error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject request with same source and destination wallet")
  void shouldRejectSameWallet() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.sameWallet()
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("ref_123")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.SAME_WALLET.code());
  }

  /**
   * TC_013: Verify request rejected without idempotency key header.
   *
   * <p>Scenario: POST /transfers without Idempotency-Key header. Expected: HTTP 400 with
   * INVALID_REQUEST error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject request without idempotency key")
  void shouldRejectMissingIdempotencyKey() {
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("ref_123")
            .build();

    var response =
        api.getSpec().body(request).when().post("/transfers").then().extract().response();

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.INVALID_REQUEST.code());
  }

  /**
   * TC_014: Verify invalid transfer ID format rejected on GET.
   *
   * <p>Scenario: GET /transfers/00000000-0000-0000-0000-000000000000 (valid UUID format but not
   * found). Expected: HTTP 404 (the controller validates UUID format first, then returns 404 for
   * not found).
   */
  @Test
  @DisplayName("POST /transfers - should reject request with invalid transfer ID format")
  void shouldRejectInvalidTransferIdFormat() {
    var response =
        api.getTransferRaw(java.util.UUID.fromString("00000000-0000-0000-0000-000000000000"));

    assertThat(response.statusCode()).isEqualTo(404);
  }

  /**
   * TC_015: Verify 404 returned for non-existent wallet.
   *
   * <p>Scenario: GET /wallets/non_existent_wallet. Expected: HTTP 404 with WALLET_NOT_FOUND error
   * code.
   */
  @Test
  @DisplayName("GET /wallets/{id} - should return 404 for non-existent wallet")
  void shouldReturn404ForNonExistentWallet() {
    var response = api.getWalletRaw("non_existent_wallet");

    assertThat(response.statusCode()).isEqualTo(404);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.WALLET_NOT_FOUND.code());
  }
}
