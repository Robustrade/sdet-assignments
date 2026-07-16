package com.wallet.transfer.database;

import static org.assertj.core.api.Assertions.assertThat;

import com.wallet.transfer.api.TransferApi;
import com.wallet.transfer.assertions.TransferAssertions;
import com.wallet.transfer.builders.TransferRequestBuilder;
import com.wallet.transfer.dto.TransferRequest;
import com.wallet.transfer.dto.TransferResponse;
import com.wallet.transfer.fixtures.TestFixture;
import com.wallet.transfer.model.AuditRecord;
import com.wallet.transfer.model.OutboxEvent;
import com.wallet.transfer.model.Transfer;
import com.wallet.transfer.model.Wallet;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Database verification tests for the wallet transfer service. These tests verify that all database
 * records are correctly persisted after transfer operations, including wallet balances, transfer
 * records, audit logs, outbox events, and idempotency records.
 */
class DatabaseVerificationTest extends TestFixture {

  private TransferAssertions assertions() {
    return TransferAssertions.with(
        walletRepository,
        transferRepository,
        auditRepository,
        outboxRepository,
        idempotencyRepository);
  }

  /**
   * TC_032: Verify wallet persisted with correct balance after transfer.
   *
   * <p>Scenario: Transfer 1000 INR from wallet_001 (10000 INR) to wallet_002 (5000 INR). Expected:
   * Source wallet balance = 9000 INR, Destination wallet balance = 6000 INR, both wallets retain
   * INR currency and correct wallet IDs.
   */
  @Test
  @DisplayName("POST /transfers - should persist wallet with correct balance after transfer")
  void shouldPersistWalletWithCorrectBalance() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("1000.00"))
            .withCurrency("INR")
            .withReference("wallet_verify_1")
            .build();

    TransferResponse response = api.createTransfer(request, idempotencyKey);

    Wallet sourceWallet = walletRepository.findById("wallet_001").orElseThrow();
    Wallet destWallet = walletRepository.findById("wallet_002").orElseThrow();

    assertThat(sourceWallet.balance()).isEqualByComparingTo("9000.00");
    assertThat(destWallet.balance()).isEqualByComparingTo("6000.00");
    assertThat(sourceWallet.currency()).isEqualTo("INR");
    assertThat(destWallet.currency()).isEqualTo("INR");
    assertThat(sourceWallet.walletId()).isEqualTo("wallet_001");
    assertThat(destWallet.walletId()).isEqualTo("wallet_002");
  }

  /**
   * TC_033: Verify transfer record persisted with all fields.
   *
   * <p>Scenario: Transfer 500 INR from wallet_001 to wallet_002. Expected: Transfer record contains
   * correct transfer ID, source/destination wallet IDs, amount, currency, reference, COMPLETED
   * status, and non-null timestamps.
   */
  @Test
  @DisplayName("POST /transfers - should persist transfer record with all fields")
  void shouldPersistTransferRecordWithAllFields() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("500.00"))
            .withCurrency("INR")
            .withReference("transfer_verify_1")
            .build();

    TransferResponse response = api.createTransfer(request, idempotencyKey);

    Transfer transfer = transferRepository.findById(response.transferId()).orElseThrow();

    assertThat(transfer.transferId()).isEqualTo(response.transferId());
    assertThat(transfer.sourceWalletId()).isEqualTo("wallet_001");
    assertThat(transfer.destinationWalletId()).isEqualTo("wallet_002");
    assertThat(transfer.amount()).isEqualByComparingTo("500.00");
    assertThat(transfer.currency()).isEqualTo("INR");
    assertThat(transfer.reference()).isEqualTo("transfer_verify_1");
    assertThat(transfer.status()).isEqualTo("COMPLETED");
    assertThat(transfer.createdAt()).isNotNull();
    assertThat(transfer.updatedAt()).isNotNull();
  }

  /**
   * TC_034: Verify failed transfer record persisted on insufficient balance.
   *
   * <p>Scenario: Transfer 5000 INR from wallet_003 (2000 INR) to wallet_001. Expected: A FAILED
   * transfer record exists with correct source/destination wallet IDs, amount 5000 INR, and FAILED
   * status.
   */
  @Test
  @DisplayName("POST /transfers - should persist failed transfer record on insufficient balance")
  void shouldPersistFailedTransferRecord() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_003", "wallet_001", new BigDecimal("5000.00"))
            .withCurrency("INR")
            .withReference("failed_transfer")
            .build();

    api.createTransferRaw(request, idempotencyKey);

    List<Transfer> allTransfers = transferRepository.findAll();
    Transfer failedTransfer =
        allTransfers.stream()
            .filter(t -> "FAILED".equals(t.status()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("No failed transfer found"));

    assertThat(failedTransfer.sourceWalletId()).isEqualTo("wallet_003");
    assertThat(failedTransfer.destinationWalletId()).isEqualTo("wallet_001");
    assertThat(failedTransfer.amount()).isEqualByComparingTo("5000.00");
    assertThat(failedTransfer.status()).isEqualTo("FAILED");
  }

  /**
   * TC_035: Verify audit records created for transfer lifecycle (3 audits).
   *
   * <p>Scenario: Transfer 750 INR from wallet_001 to wallet_002. Expected: 3 audit records created
   * - TRANSFER_CREATED, DEBIT, CREDIT. All audits reference the correct transfer ID and have
   * non-null timestamps.
   */
  @Test
  @DisplayName("POST /transfers - should create audit records for transfer lifecycle")
  void shouldCreateAuditRecordsForTransferLifecycle() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("750.00"))
            .withCurrency("INR")
            .withReference("audit_verify_1")
            .build();

    TransferResponse response = api.createTransfer(request, idempotencyKey);

    List<AuditRecord> audits = auditRepository.findByTransferId(response.transferId());

    assertThat(audits).hasSize(3);

    assertThat(audits.stream().anyMatch(a -> "TRANSFER_CREATED".equals(a.action()))).isTrue();
    assertThat(audits.stream().anyMatch(a -> "DEBIT".equals(a.action()))).isTrue();
    assertThat(audits.stream().anyMatch(a -> "CREDIT".equals(a.action()))).isTrue();

    for (AuditRecord audit : audits) {
      assertThat(audit.transferId()).isEqualTo(response.transferId());
      assertThat(audit.timestamp()).isNotNull();
    }
  }

  /**
   * TC_036: Verify audit record created for failed transfer.
   *
   * <p>Scenario: Transfer 5000 INR from wallet_003 (2000 INR) to wallet_001. Expected: 1 audit
   * record with TRANSFER_FAILED action and "Insufficient balance" in details.
   */
  @Test
  @DisplayName("POST /transfers - should create audit record for failed transfer")
  void shouldCreateAuditRecordForFailedTransfer() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_003", "wallet_001", new BigDecimal("5000.00"))
            .withCurrency("INR")
            .withReference("failed_audit")
            .build();

    api.createTransferRaw(request, idempotencyKey);

    List<Transfer> failedTransfers =
        transferRepository.findAll().stream().filter(t -> "FAILED".equals(t.status())).toList();

    assertThat(failedTransfers).hasSize(1);

    UUID failedTransferId = failedTransfers.get(0).transferId();
    List<AuditRecord> audits = auditRepository.findByTransferId(failedTransferId);

    assertThat(audits).hasSize(1);
    assertThat(audits.get(0).action()).isEqualTo("TRANSFER_FAILED");
    assertThat(audits.get(0).details()).contains("Insufficient balance");
  }

  /**
   * TC_037: Verify outbox event created for completed transfer.
   *
   * <p>Scenario: Transfer 250 INR from wallet_001 to wallet_002. Expected: 1 outbox event with
   * TRANSFER_COMPLETED type, correct aggregate ID, non-null payload, published = false, and
   * non-null createdAt timestamp.
   */
  @Test
  @DisplayName("POST /transfers - should create outbox event for completed transfer")
  void shouldCreateOutboxEventForCompletedTransfer() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("250.00"))
            .withCurrency("INR")
            .withReference("outbox_verify_1")
            .build();

    TransferResponse response = api.createTransfer(request, idempotencyKey);

    List<OutboxEvent> events = outboxRepository.findAll();
    OutboxEvent transferEvent =
        events.stream()
            .filter(
                e ->
                    e.aggregateId().equals(response.transferId().toString())
                        && "TRANSFER_COMPLETED".equals(e.eventType())
                        && !e.published())
            .findFirst()
            .orElseThrow(() -> new AssertionError("Outbox event not found"));

    assertThat(transferEvent.aggregateId()).isEqualTo(response.transferId().toString());
    assertThat(transferEvent.eventType()).isEqualTo("TRANSFER_COMPLETED");
    assertThat(transferEvent.payload()).isNotNull();
    assertThat(transferEvent.published()).isFalse();
    assertThat(transferEvent.createdAt()).isNotNull();
  }

  /**
   * TC_038: Verify no outbox event created for failed transfer.
   *
   * <p>Scenario: Transfer 5000 INR from wallet_003 (2000 INR) to wallet_001. Expected: No
   * TRANSFER_COMPLETED outbox event exists for the failed transfer.
   */
  @Test
  @DisplayName("POST /transfers - should not create outbox event for failed transfer")
  void shouldNotCreateOutboxEventForFailedTransfer() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_003", "wallet_001", new BigDecimal("5000.00"))
            .withCurrency("INR")
            .withReference("failed_outbox")
            .build();

    api.createTransferRaw(request, idempotencyKey);

    List<OutboxEvent> events = outboxRepository.findAll();
    List<Transfer> failedTransfers =
        transferRepository.findAll().stream().filter(t -> "FAILED".equals(t.status())).toList();

    for (Transfer failedTransfer : failedTransfers) {
      boolean hasOutboxEvent =
          events.stream()
              .anyMatch(
                  e ->
                      e.aggregateId().equals(failedTransfer.transferId().toString())
                          && "TRANSFER_COMPLETED".equals(e.eventType()));
      assertThat(hasOutboxEvent).isFalse();
    }
  }

  /**
   * TC_039: Verify idempotency record stored correctly.
   *
   * <p>Scenario: Transfer 100 INR from wallet_001 to wallet_002. Expected: Idempotency record
   * exists with correct key, non-null request hash, response with COMPLETED status and non-null
   * transfer ID.
   */
  @Test
  @DisplayName("POST /transfers - should verify idempotency record is stored correctly")
  void shouldVerifyIdempotencyRecordStored() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("idempotency_verify_1")
            .build();

    api.createTransfer(request, idempotencyKey);

    var record = idempotencyRepository.findById(idempotencyKey).orElseThrow();

    assertThat(record.idempotencyKey()).isEqualTo(idempotencyKey);
    assertThat(record.requestHash()).isNotNull();
    assertThat(record.response()).isNotNull();
    assertThat(record.response().status()).isEqualTo("COMPLETED");
    assertThat(record.response().transferId()).isNotNull();
  }

  /**
   * TC_040: Verify no duplicate records created on duplicate request.
   *
   * <p>Scenario: Submit same transfer request twice with same idempotency key. Expected: Exactly 1
   * COMPLETED transfer, 3 audit records, 1 outbox event, 1 idempotency record.
   */
  @Test
  @DisplayName("POST /transfers - should not create duplicate records on duplicate request")
  void shouldNotCreateDuplicateRecordsOnDuplicateRequest() {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("300.00"))
            .withCurrency("INR")
            .withReference("no_dup_1")
            .build();

    api.createTransfer(request, idempotencyKey);
    api.createTransfer(request, idempotencyKey);

    List<Transfer> transfers = transferRepository.findAll();
    long completedCount = transfers.stream().filter(t -> "COMPLETED".equals(t.status())).count();
    assertThat(completedCount).isEqualTo(1);

    long auditCount = auditRepository.countByTransferId(transfers.get(0).transferId());
    assertThat(auditCount).isEqualTo(3);

    long outboxCount =
        outboxRepository.countByAggregateId(transfers.get(0).transferId().toString());
    assertThat(outboxCount).isEqualTo(1);

    assertThat(idempotencyRepository.existsById(idempotencyKey)).isTrue();
  }
}
