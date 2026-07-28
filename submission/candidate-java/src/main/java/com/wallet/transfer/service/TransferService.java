package com.wallet.transfer.service;

import com.wallet.transfer.dto.TransferRequest;
import com.wallet.transfer.dto.TransferResponse;
import com.wallet.transfer.model.AuditRecord;
import com.wallet.transfer.model.IdempotencyRecord;
import com.wallet.transfer.model.OutboxEvent;
import com.wallet.transfer.model.Transfer;
import com.wallet.transfer.model.TransferErrorCode;
import com.wallet.transfer.model.TransferResult;
import com.wallet.transfer.model.Wallet;
import com.wallet.transfer.repository.AuditRepository;
import com.wallet.transfer.repository.IdempotencyRepository;
import com.wallet.transfer.repository.OutboxRepository;
import com.wallet.transfer.repository.TransferRepository;
import com.wallet.transfer.repository.WalletRepository;
import com.wallet.transfer.util.RequestHashUtil;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class TransferService {
  private static final Logger log = LoggerFactory.getLogger(TransferService.class);

  private final WalletRepository walletRepository;
  private final TransferRepository transferRepository;
  private final AuditRepository auditRepository;
  private final OutboxRepository outboxRepository;
  private final IdempotencyRepository idempotencyRepository;

  public TransferService(
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

  public TransferResult createTransfer(String idempotencyKey, TransferRequest request) {
    String requestHash = RequestHashUtil.hash(request);

    Optional<IdempotencyRecord> existingRecord = idempotencyRepository.findById(idempotencyKey);
    if (existingRecord.isPresent()) {
      if (!existingRecord.get().requestHash().equals(requestHash)) {
        log.warn(
            "Idempotency key conflict: key={}, existingHash={}, newHash={}",
            idempotencyKey,
            existingRecord.get().requestHash(),
            requestHash);
        return TransferResult.failure(TransferErrorCode.IDEMPOTENCY_KEY_CONFLICT);
      }
      log.info("Duplicate request with idempotency key: {}", idempotencyKey);
      return TransferResult.success(existingRecord.get().response());
    }

    if (!idempotencyRepository.tryAcquireLock(idempotencyKey)) {
      log.info("Concurrent request with idempotency key, waiting: {}", idempotencyKey);
      IdempotencyRecord completedRecord = idempotencyRepository.waitForCompletion(idempotencyKey);
      if (completedRecord != null && completedRecord.requestHash().equals(requestHash)) {
        return TransferResult.success(completedRecord.response());
      }
      return TransferResult.failure(TransferErrorCode.IDEMPOTENCY_KEY_CONFLICT);
    }

    try {
      if (request.sourceWalletId().equals(request.destinationWalletId())) {
        return TransferResult.failure(TransferErrorCode.SAME_WALLET);
      }

      Optional<Wallet> sourceWalletOpt = walletRepository.findById(request.sourceWalletId());
      if (sourceWalletOpt.isEmpty()) {
        return TransferResult.failure(TransferErrorCode.WALLET_NOT_FOUND);
      }

      Optional<Wallet> destinationWalletOpt =
          walletRepository.findById(request.destinationWalletId());
      if (destinationWalletOpt.isEmpty()) {
        return TransferResult.failure(TransferErrorCode.WALLET_NOT_FOUND);
      }

      Wallet sourceWallet = sourceWalletOpt.get();
      Wallet destinationWallet = destinationWalletOpt.get();

      if (!sourceWallet.currency().equals(request.currency())) {
        return TransferResult.failure(TransferErrorCode.INVALID_CURRENCY);
      }

      if (request.amount().compareTo(BigDecimal.ZERO) <= 0) {
        return TransferResult.failure(TransferErrorCode.INVALID_AMOUNT);
      }

      if (!sourceWallet.hasSufficientBalance(request.amount())) {
        Transfer transfer = createFailedTransfer(request, "Insufficient balance");
        transferRepository.save(transfer);
        auditRepository.save(AuditRecord.createFailedAudit(transfer, "Insufficient balance"));
        return TransferResult.failure(TransferErrorCode.INSUFFICIENT_BALANCE);
      }

      BigDecimal newSourceBalance = sourceWallet.balance().subtract(request.amount());
      if (!walletRepository.updateBalance(
          request.sourceWalletId(), sourceWallet.balance(), newSourceBalance)) {
        return TransferResult.failure(TransferErrorCode.INSUFFICIENT_BALANCE);
      }

      BigDecimal newDestBalance = destinationWallet.balance().add(request.amount());
      if (!walletRepository.updateBalance(
          request.destinationWalletId(), destinationWallet.balance(), newDestBalance)) {
        // Rollback source wallet
        walletRepository.updateBalance(
            request.sourceWalletId(), newSourceBalance, sourceWallet.balance());
        return TransferResult.failure(TransferErrorCode.INSUFFICIENT_BALANCE);
      }

      // Fetch updated wallets for audit records
      Wallet debitedSource = walletRepository.findById(request.sourceWalletId()).orElseThrow();
      Wallet creditedDestination =
          walletRepository.findById(request.destinationWalletId()).orElseThrow();

      Transfer transfer = createCompletedTransfer(request);
      transferRepository.save(transfer);

      auditRepository.save(AuditRecord.createTransferAudit(transfer));
      auditRepository.save(AuditRecord.createDebitAudit(debitedSource, transfer));
      auditRepository.save(AuditRecord.createCreditAudit(creditedDestination, transfer));

      OutboxEvent outboxEvent = OutboxEvent.createTransferCompletedEvent(transfer);
      outboxRepository.save(outboxEvent);

      TransferResponse response = toResponse(transfer);
      idempotencyRepository.save(IdempotencyRecord.create(idempotencyKey, requestHash, response));
      idempotencyRepository.releaseLock(idempotencyKey);

      log.info("Transfer completed: {}", transfer.transferId());
      return TransferResult.success(response);
    } catch (Exception e) {
      idempotencyRepository.releaseLock(idempotencyKey);
      throw e;
    }
  }

  public Optional<TransferResponse> getTransfer(UUID transferId) {
    return transferRepository.findById(transferId).map(this::toResponse);
  }

  public Optional<Wallet> getWallet(String walletId) {
    return walletRepository.findById(walletId);
  }

  private Transfer createCompletedTransfer(TransferRequest request) {
    Instant now = Instant.now();
    return new Transfer(
        UUID.randomUUID(),
        request.sourceWalletId(),
        request.destinationWalletId(),
        request.amount(),
        request.currency(),
        request.reference(),
        "COMPLETED",
        now,
        now);
  }

  private Transfer createFailedTransfer(TransferRequest request, String reason) {
    Instant now = Instant.now();
    return new Transfer(
        UUID.randomUUID(),
        request.sourceWalletId(),
        request.destinationWalletId(),
        request.amount(),
        request.currency(),
        request.reference(),
        "FAILED",
        now,
        now);
  }

  private TransferResponse toResponse(Transfer transfer) {
    return new TransferResponse(
        transfer.transferId(),
        transfer.sourceWalletId(),
        transfer.destinationWalletId(),
        transfer.amount(),
        transfer.currency(),
        transfer.reference(),
        transfer.status(),
        transfer.createdAt());
  }
}
