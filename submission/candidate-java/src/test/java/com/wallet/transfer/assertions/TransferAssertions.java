package com.wallet.transfer.assertions;

import com.wallet.transfer.dto.TransferResponse;
import com.wallet.transfer.model.AuditRecord;
import com.wallet.transfer.model.IdempotencyRecord;
import com.wallet.transfer.model.OutboxEvent;
import com.wallet.transfer.model.Transfer;
import com.wallet.transfer.model.Wallet;
import com.wallet.transfer.repository.AuditRepository;
import com.wallet.transfer.repository.IdempotencyRepository;
import com.wallet.transfer.repository.OutboxRepository;
import com.wallet.transfer.repository.TransferRepository;
import com.wallet.transfer.repository.WalletRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.assertj.core.api.Assertions;

public class TransferAssertions {
  private final WalletRepository walletRepository;
  private final TransferRepository transferRepository;
  private final AuditRepository auditRepository;
  private final OutboxRepository outboxRepository;
  private final IdempotencyRepository idempotencyRepository;

  public TransferAssertions(
      WalletRepository walletRepository,
      TransferRepository transferRepository,
      AuditRepository auditRepository,
      OutboxRepository outboxRepository,
      IdempotencyRepository idempotencyRepository) {
    this.walletRepository = walletRepository;
    this.transferRepository = transferRepository;
    this.auditRepository = auditRepository;
    this.outboxRepository = outboxRepository;
    this.idempotencyRepository = idempotencyRepository;
  }

  public void assertTransferCompleted(TransferResponse response) {
    Assertions.assertThat(response.status()).isEqualTo("COMPLETED");
    Assertions.assertThat(response.transferId()).isNotNull();
    Assertions.assertThat(response.amount()).isNotNull();
    Assertions.assertThat(response.currency()).isEqualTo("INR");
  }

  public void assertWalletBalances(
      String sourceWalletId,
      String destWalletId,
      BigDecimal sourceExpected,
      BigDecimal destExpected) {
    Wallet source =
        walletRepository
            .findById(sourceWalletId)
            .orElseThrow(() -> new AssertionError("Source wallet not found: " + sourceWalletId));
    Wallet dest =
        walletRepository
            .findById(destWalletId)
            .orElseThrow(() -> new AssertionError("Destination wallet not found: " + destWalletId));

    Assertions.assertThat(source.balance())
        .as("Source wallet balance")
        .isEqualByComparingTo(sourceExpected);

    Assertions.assertThat(dest.balance())
        .as("Destination wallet balance")
        .isEqualByComparingTo(destExpected);
  }

  public void assertTransferPersisted(UUID transferId, String expectedStatus) {
    Transfer transfer =
        transferRepository
            .findById(transferId)
            .orElseThrow(() -> new AssertionError("Transfer not found: " + transferId));

    Assertions.assertThat(transfer.status()).isEqualTo(expectedStatus);
    Assertions.assertThat(transfer.sourceWalletId()).isNotNull();
    Assertions.assertThat(transfer.destinationWalletId()).isNotNull();
    Assertions.assertThat(transfer.amount()).isNotNull();
  }

  public void assertAuditRecordCreated(UUID transferId, int expectedCount) {
    List<AuditRecord> audits = auditRepository.findByTransferId(transferId);
    Assertions.assertThat(audits)
        .as("Audit records for transfer %s", transferId)
        .hasSize(expectedCount);

    boolean hasTransferAudit = audits.stream().anyMatch(a -> "TRANSFER_CREATED".equals(a.action()));
    Assertions.assertThat(hasTransferAudit).isTrue();

    boolean hasDebitAudit = audits.stream().anyMatch(a -> "DEBIT".equals(a.action()));
    Assertions.assertThat(hasDebitAudit).isTrue();

    boolean hasCreditAudit = audits.stream().anyMatch(a -> "CREDIT".equals(a.action()));
    Assertions.assertThat(hasCreditAudit).isTrue();
  }

  public void assertOutboxEventCreated(UUID transferId) {
    List<OutboxEvent> events = outboxRepository.findAll();
    boolean hasEvent =
        events.stream()
            .anyMatch(
                e ->
                    e.aggregateId().equals(transferId.toString())
                        && "TRANSFER_COMPLETED".equals(e.eventType())
                        && !e.published());

    Assertions.assertThat(hasEvent).as("Outbox event for transfer %s", transferId).isTrue();
  }

  public void assertIdempotencyRecordStored(String idempotencyKey) {
    IdempotencyRecord record =
        idempotencyRepository
            .findById(idempotencyKey)
            .orElseThrow(
                () -> new AssertionError("Idempotency record not found: " + idempotencyKey));

    Assertions.assertThat(record.idempotencyKey()).isEqualTo(idempotencyKey);
    Assertions.assertThat(record.response()).isNotNull();
    Assertions.assertThat(record.response().status()).isEqualTo("COMPLETED");
  }

  public void assertNoDuplicateSideEffects(UUID transferId) {
    List<Transfer> transfers = transferRepository.findAll();
    long count = transfers.stream().filter(t -> t.transferId().equals(transferId)).count();
    Assertions.assertThat(count).as("Duplicate transfers").isEqualTo(1);

    long auditCount = auditRepository.countByTransferId(transferId);
    Assertions.assertThat(auditCount).as("Duplicate audit records").isEqualTo(3);

    long outboxCount = outboxRepository.countByAggregateId(transferId.toString());
    Assertions.assertThat(outboxCount).as("Duplicate outbox events").isEqualTo(1);
  }

  public void assertConservationOfValue(BigDecimal initialTotal, BigDecimal finalTotal) {
    Assertions.assertThat(finalTotal)
        .as("Total wallet balance conservation")
        .isEqualByComparingTo(initialTotal);
  }

  public void assertInsufficientBalanceRejected(TransferResponse response) {
    Assertions.assertThat(response.status()).isEqualTo("FAILED");
  }

  public void assertValidationError(int statusCode) {
    Assertions.assertThat(statusCode).isIn(400, 409);
  }

  public static TransferAssertions with(
      WalletRepository walletRepository,
      TransferRepository transferRepository,
      AuditRepository auditRepository,
      OutboxRepository outboxRepository,
      IdempotencyRepository idempotencyRepository) {
    return new TransferAssertions(
        walletRepository,
        transferRepository,
        auditRepository,
        outboxRepository,
        idempotencyRepository);
  }
}
