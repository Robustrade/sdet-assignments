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
 * API tests for insufficient balance and invalid wallet scenarios. These tests verify that
 * transfers are properly rejected when balance is insufficient or when wallets don't exist, and
 * that no balance changes occur on rejection.
 */
class InsufficientBalanceAndInvalidWalletTest extends TestFixture {

  /**
   * TC_016: Verify transfer rejected with insufficient balance.
   *
   * <p>Scenario: wallet_003 has 2000 INR, attempt to transfer 5000 INR to wallet_001. Expected:
   * HTTP 409 with INSUFFICIENT_BALANCE error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject transfer with insufficient balance")
  void shouldRejectInsufficientBalance() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_003")
            .withDestinationWalletId("wallet_001")
            .withAmount(new BigDecimal("5000.00"))
            .withCurrency("INR")
            .withReference("large_transfer")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(409);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.INSUFFICIENT_BALANCE.code());
  }

  /**
   * TC_017: Verify transfer rejected when source wallet has zero balance.
   *
   * <p>Scenario: Create wallet_empty with 0 INR balance, attempt to transfer 1 INR to wallet_001.
   * Expected: HTTP 409 with INSUFFICIENT_BALANCE error code.
   */
  @Test
  @DisplayName(
      "POST /transfers - should reject transfer when source wallet has exactly zero balance")
  void shouldRejectWhenSourceWalletZeroBalance() {
    walletRepository.save(
        new com.wallet.transfer.model.Wallet(
            "wallet_empty",
            new BigDecimal("0.00"),
            "INR",
            java.time.Instant.now(),
            java.time.Instant.now()));

    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_empty")
            .withDestinationWalletId("wallet_001")
            .withAmount(new BigDecimal("1.00"))
            .withCurrency("INR")
            .withReference("from_empty")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(409);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.INSUFFICIENT_BALANCE.code());
  }

  /**
   * TC_018: Verify transfer rejected to non-existent destination wallet.
   *
   * <p>Scenario: Transfer from wallet_001 to wallet_nonexistent. Expected: HTTP 404 with
   * WALLET_NOT_FOUND error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject transfer to non-existent destination wallet")
  void shouldRejectNonExistentDestinationWallet() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_nonexistent")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("to_missing")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(404);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.WALLET_NOT_FOUND.code());
  }

  /**
   * TC_019: Verify transfer rejected from non-existent source wallet.
   *
   * <p>Scenario: Transfer from wallet_nonexistent to wallet_001. Expected: HTTP 404 with
   * WALLET_NOT_FOUND error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject transfer from non-existent source wallet")
  void shouldRejectNonExistentSourceWallet() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_nonexistent")
            .withDestinationWalletId("wallet_001")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("from_missing")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(404);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.WALLET_NOT_FOUND.code());
  }

  /**
   * TC_020: Verify transfer rejected with mismatched currency.
   *
   * <p>Scenario: Transfer from wallet_001 (INR) to wallet_002 (INR) but request specifies USD
   * currency. Expected: HTTP 400 with INVALID_CURRENCY error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject transfer with mismatched currency")
  void shouldRejectMismatchedCurrency() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("USD")
            .withReference("wrong_currency")
            .build();

    var response = api.createTransferRaw(request, idempotencyKey);

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.INVALID_CURRENCY.code());
  }

  /**
   * TC_021: Verify 404 returned for non-existent transfer.
   *
   * <p>Scenario: GET /transfers/{random-UUID}. Expected: HTTP 404 with TRANSFER_NOT_FOUND error
   * code.
   */
  @Test
  @DisplayName("GET /transfers/{id} - should return 404 for non-existent transfer")
  void shouldReturn404ForNonExistentTransfer() {
    var response = api.getTransferRaw(java.util.UUID.randomUUID());

    assertThat(response.statusCode()).isEqualTo(404);
    assertThat(response.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.TRANSFER_NOT_FOUND.code());
  }

  /**
   * TC_022: Verify no balance modification on insufficient balance rejection.
   *
   * <p>Scenario: Attempt transfer of 5000 INR from wallet_003 (2000 INR) to wallet_001. Expected:
   * Both wallet balances remain unchanged after rejection.
   */
  @Test
  @DisplayName(
      "POST /transfers - should not modify wallet balances on insufficient balance rejection")
  void shouldNotModifyBalancesOnInsufficientBalanceRejection() {
    var initialSource = walletRepository.findById("wallet_003").orElseThrow();
    var initialDest = walletRepository.findById("wallet_001").orElseThrow();

    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_003")
            .withDestinationWalletId("wallet_001")
            .withAmount(new BigDecimal("5000.00"))
            .withCurrency("INR")
            .withReference("large_transfer")
            .build();

    api.createTransferRaw(request, idempotencyKey);

    var afterSource = walletRepository.findById("wallet_003").orElseThrow();
    var afterDest = walletRepository.findById("wallet_001").orElseThrow();

    assertThat(afterSource.balance()).isEqualByComparingTo(initialSource.balance());
    assertThat(afterDest.balance()).isEqualByComparingTo(initialDest.balance());
  }

  /**
   * TC_023: Verify no balance modification on invalid wallet rejection.
   *
   * <p>Scenario: Attempt transfer from wallet_001 to wallet_nonexistent. Expected: Source wallet
   * balance remains unchanged after rejection.
   */
  @Test
  @DisplayName("POST /transfers - should not modify wallet balances on invalid wallet rejection")
  void shouldNotModifyBalancesOnInvalidWalletRejection() {
    var initialSource = walletRepository.findById("wallet_001").orElseThrow();

    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.aTransfer()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_nonexistent")
            .withAmount(new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("to_missing")
            .build();

    api.createTransferRaw(request, idempotencyKey);

    var afterSource = walletRepository.findById("wallet_001").orElseThrow();

    assertThat(afterSource.balance()).isEqualByComparingTo(initialSource.balance());
  }
}
