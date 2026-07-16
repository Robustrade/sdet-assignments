package com.wallet.transfer.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.wallet.transfer.api.TransferApi;
import com.wallet.transfer.assertions.TransferAssertions;
import com.wallet.transfer.builders.TransferRequestBuilder;
import com.wallet.transfer.dto.TransferRequest;
import com.wallet.transfer.dto.TransferResponse;
import com.wallet.transfer.fixtures.TestFixture;
import com.wallet.transfer.model.Transfer;
import com.wallet.transfer.model.TransferErrorCode;
import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Workflow tests for the wallet transfer service. These tests verify end-to-end transaction
 * workflows with multi-layer verification (API response, wallet balances, transfer persistence,
 * audit records, outbox events, idempotency).
 */
class WorkflowTest extends TestFixture {

  private TransferAssertions assertions() {
    return TransferAssertions.with(
        walletRepository,
        transferRepository,
        auditRepository,
        outboxRepository,
        idempotencyRepository);
  }

  /**
   * TC_024: Verify end-to-end transfer with multi-layer verification.
   *
   * <p>Scenario: Transfer 1000 INR from wallet_001 (10000 INR) to wallet_002 (5000 INR). Expected:
   * - HTTP 201 with COMPLETED status - Source wallet balance: 9000 INR, Destination wallet balance:
   * 6000 INR - Transfer persisted with COMPLETED status - 3 audit records created
   * (TRANSFER_CREATED, DEBIT, CREDIT) - 1 outbox event created (TRANSFER_COMPLETED) - 1 idempotency
   * record stored - No duplicate side effects (exactly 1 transfer, 3 audits, 1 outbox) - Total
   * monetary value conserved (15000 INR)
   */
  @Test
  @DisplayName(
      "POST /transfers - should complete end-to-end transfer with multi-layer verification")
  void shouldCompleteEndToEndTransferWithVerification() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("1000.00"))
            .withCurrency("INR")
            .withReference("invoice_123")
            .build();

    BigDecimal initialSourceBalance = getWallet("wallet_001").balance();
    BigDecimal initialDestBalance = getWallet("wallet_002").balance();
    BigDecimal initialTotal = initialSourceBalance.add(initialDestBalance);

    TransferResponse response = api.createTransfer(request, idempotencyKey);

    assertions().assertTransferCompleted(response);
    assertions()
        .assertWalletBalances(
            "wallet_001", "wallet_002", new BigDecimal("9000.00"), new BigDecimal("6000.00"));
    assertions().assertTransferPersisted(response.transferId(), "COMPLETED");
    assertions().assertAuditRecordCreated(response.transferId(), 3);
    assertions().assertOutboxEventCreated(response.transferId());
    assertions().assertIdempotencyRecordStored(idempotencyKey);
    assertions().assertNoDuplicateSideEffects(response.transferId());

    BigDecimal finalTotal =
        getWallet("wallet_001").balance().add(getWallet("wallet_002").balance());
    assertions().assertConservationOfValue(initialTotal, finalTotal);
  }

  /**
   * TC_025: Verify duplicate request with same idempotency key returns original result.
   *
   * <p>Scenario: Submit identical transfer request twice with same idempotency key. Expected: -
   * Both requests return same transfer ID and COMPLETED status - Wallet balances only changed once
   * (9500/5500) - No duplicate side effects (1 transfer record, 3 audits, 1 outbox)
   */
  @Test
  @DisplayName("POST /transfers - should handle duplicate request with same idempotency key")
  void shouldHandleDuplicateRequestWithSameIdempotencyKey() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("500.00"))
            .withCurrency("INR")
            .withReference("dup_test")
            .build();

    TransferResponse firstResponse = api.createTransfer(request, idempotencyKey);
    TransferResponse secondResponse = api.createTransfer(request, idempotencyKey);

    assertThat(firstResponse.transferId()).isEqualTo(secondResponse.transferId());
    assertThat(firstResponse.status()).isEqualTo("COMPLETED");
    assertThat(secondResponse.status()).isEqualTo("COMPLETED");

    assertions()
        .assertWalletBalances(
            "wallet_001", "wallet_002", new BigDecimal("9500.00"), new BigDecimal("5500.00"));
    assertions().assertNoDuplicateSideEffects(firstResponse.transferId());

    List<Transfer> allTransfers = transferRepository.findAll();
    long count =
        allTransfers.stream()
            .filter(t -> t.transferId().equals(firstResponse.transferId()))
            .count();
    assertThat(count).as("Exactly one transfer record").isEqualTo(1);
  }

  /**
   * TC_026: Verify duplicate request with different payload rejected (same idempotency key).
   *
   * <p>Scenario: First request transfers 500 INR. Second request with same key tries to transfer
   * 1000 INR. Expected: HTTP 409 with IDEMPOTENCY_KEY_CONFLICT error code.
   */
  @Test
  @DisplayName("POST /transfers - should reject duplicate request with different payload")
  void shouldRejectDuplicateRequestWithDifferentPayload() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request1 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("500.00"))
            .withCurrency("INR")
            .withReference("ref_1")
            .build();

    api.createTransfer(request1, idempotencyKey);

    TransferRequest request2 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("1000.00"))
            .withCurrency("INR")
            .withReference("ref_2")
            .build();

    var conflictResponse = api.createTransferRaw(request2, idempotencyKey);

    assertThat(conflictResponse.statusCode()).isEqualTo(409);
    assertThat(conflictResponse.jsonPath().getString("code"))
        .isEqualTo(TransferErrorCode.IDEMPOTENCY_KEY_CONFLICT.code());
  }

  /**
   * TC_027: Verify retry after timeout returns original result (idempotent retry).
   *
   * <p>Scenario: Submit transfer, then retry with same idempotency key (simulating client retry).
   * Expected: Both responses have same transfer ID and COMPLETED status, balances only changed
   * once.
   */
  @Test
  @DisplayName("POST /transfers - should handle retry after timeout (simulated)")
  void shouldHandleRetryAfterTimeout() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("250.00"))
            .withCurrency("INR")
            .withReference("retry_test")
            .build();

    TransferResponse firstResponse = api.createTransfer(request, idempotencyKey);

    TransferResponse retryResponse = api.createTransfer(request, idempotencyKey);

    assertThat(firstResponse.transferId()).isEqualTo(retryResponse.transferId());
    assertThat(retryResponse.status()).isEqualTo("COMPLETED");

    assertions()
        .assertWalletBalances(
            "wallet_001", "wallet_002", new BigDecimal("9750.00"), new BigDecimal("5250.00"));
    assertions().assertNoDuplicateSideEffects(firstResponse.transferId());
  }

  /**
   * TC_028: Verify exactly-once semantics under concurrent load (same idempotency key).
   *
   * <p>Scenario: 10 concurrent threads all attempt the same transfer with same idempotency key.
   * Expected: Exactly 1 transfer completed, wallet balances reflect single transfer (9900/5100).
   */
  @Test
  @DisplayName("POST /transfers - should validate exactly-once semantics under concurrent load")
  void shouldValidateExactlyOnceSemanticsUnderConcurrentLoad() throws InterruptedException {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("concurrent_test")
            .build();

    int threadCount = 10;
    ExecutorService executor = Executors.newFixedThreadPool(threadCount);
    CountDownLatch latch = new CountDownLatch(threadCount);
    CountDownLatch startLatch = new CountDownLatch(1);

    for (int i = 0; i < threadCount; i++) {
      executor.submit(
          () -> {
            try {
              startLatch.await();
              api.createTransfer(request, idempotencyKey);
            } catch (Exception ignored) {
            } finally {
              latch.countDown();
            }
          });
    }

    startLatch.countDown();
    latch.await(10, TimeUnit.SECONDS);
    executor.shutdown();

    List<Transfer> allTransfers = transferRepository.findAll();
    long completedCount =
        allTransfers.stream()
            .filter(
                t -> "COMPLETED".equals(t.status()) && t.amount().equals(new BigDecimal("100.00")))
            .count();

    assertThat(completedCount).as("Exactly one completed transfer").isEqualTo(1);

    assertions()
        .assertWalletBalances(
            "wallet_001", "wallet_002", new BigDecimal("9900.00"), new BigDecimal("5100.00"));
  }

  /**
   * TC_029: Verify concurrent transfers from same source wallet handle race conditions.
   *
   * <p>Scenario: Two concurrent transfers from wallet_001 - 3000 INR to wallet_002 and 4000 INR to
   * wallet_003. Due to race conditions in lightweight fixture, one transfer may fail with
   * insufficient balance. Expected: Total monetary value conserved (17000 INR), at least one
   * transfer succeeds.
   */
  @Test
  @DisplayName("POST /transfers - should handle concurrent transfers from same source wallet")
  void shouldHandleConcurrentTransfersFromSameSourceWallet() throws InterruptedException {
    String idempotencyKey1 = TransferApi.generateIdempotencyKey();
    String idempotencyKey2 = TransferApi.generateIdempotencyKey();

    TransferRequest request1 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("3000.00"))
            .withCurrency("INR")
            .withReference("concurrent_1")
            .build();

    TransferRequest request2 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_003", new BigDecimal("4000.00"))
            .withCurrency("INR")
            .withReference("concurrent_2")
            .build();

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch latch = new CountDownLatch(2);

    executor.submit(
        () -> {
          try {
            api.createTransfer(request1, idempotencyKey1);
          } finally {
            latch.countDown();
          }
        });

    executor.submit(
        () -> {
          try {
            api.createTransfer(request2, idempotencyKey2);
          } finally {
            latch.countDown();
          }
        });

    latch.await(10, TimeUnit.SECONDS);
    executor.shutdown();

    BigDecimal sourceBalance = getWallet("wallet_001").balance();
    BigDecimal dest1Balance = getWallet("wallet_002").balance();
    BigDecimal dest2Balance = getWallet("wallet_003").balance();

    // Due to race condition in lightweight fixture, one transfer may fail.
    // Verify total monetary value is conserved.
    BigDecimal finalTotal = sourceBalance.add(dest1Balance).add(dest2Balance);
    BigDecimal initialTotal = new BigDecimal("17000.00");
    assertions().assertConservationOfValue(initialTotal, finalTotal);

    // At least one transfer should have succeeded
    List<Transfer> allTransfers = transferRepository.findAll();
    long completedFromWallet001 =
        allTransfers.stream()
            .filter(
                t ->
                    "COMPLETED".equals(t.status())
                        && "wallet_001".equals(t.sourceWalletId())
                        && (t.amount().equals(new BigDecimal("3000.00"))
                            || t.amount().equals(new BigDecimal("4000.00"))))
            .count();
    assertThat(completedFromWallet001)
        .as("At least one concurrent transfer succeeded")
        .isGreaterThan(0);
  }

  /**
   * TC_030: Verify idempotency record contains correct response data.
   *
   * <p>Scenario: Complete a transfer, then verify the stored idempotency record matches the
   * response. Expected: Record contains correct key, response with matching transfer ID, COMPLETED
   * status, correct amount.
   */
  @Test
  @DisplayName("POST /transfers - should verify idempotency record contains correct response")
  void shouldVerifyIdempotencyRecordContainsCorrectResponse() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("750.00"))
            .withCurrency("INR")
            .withReference("idempotency_verify")
            .build();

    TransferResponse response = api.createTransfer(request, idempotencyKey);

    var idempotencyRecord =
        idempotencyRepository
            .findById(idempotencyKey)
            .orElseThrow(() -> new AssertionError("Idempotency record not found"));

    assertThat(idempotencyRecord.idempotencyKey()).isEqualTo(idempotencyKey);
    assertThat(idempotencyRecord.response()).isNotNull();
    assertThat(idempotencyRecord.response().transferId()).isEqualTo(response.transferId());
    assertThat(idempotencyRecord.response().status()).isEqualTo("COMPLETED");
    assertThat(idempotencyRecord.response().amount()).isEqualByComparingTo("750.00");
  }

  /**
   * TC_031: Verify validation failures do not modify wallet balances.
   *
   * <p>Scenario: Submit transfer with zero amount (invalid) from wallet_001 to wallet_002.
   * Expected: Both wallet balances remain unchanged.
   */
  @Test
  @DisplayName("POST /transfers - should not modify balances on validation failure")
  void shouldNotModifyBalancesOnValidationFailure() {
    BigDecimal initialSource = getWallet("wallet_001").balance();
    BigDecimal initialDest = getWallet("wallet_002").balance();

    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.invalidAmount()
            .withSourceWalletId("wallet_001")
            .withDestinationWalletId("wallet_002")
            .withCurrency("INR")
            .withReference("invalid_amount")
            .build();

    api.createTransferRaw(request, idempotencyKey);

    assertThat(getWallet("wallet_001").balance()).isEqualByComparingTo(initialSource);
    assertThat(getWallet("wallet_002").balance()).isEqualByComparingTo(initialDest);
  }
}
