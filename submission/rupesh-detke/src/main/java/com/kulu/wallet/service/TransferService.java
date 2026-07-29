package com.kulu.wallet.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kulu.wallet.db.Database;
import com.kulu.wallet.db.EventRepository;
import com.kulu.wallet.db.IdempotencyRepository;
import com.kulu.wallet.db.TransferRepository;
import com.kulu.wallet.db.WalletRepository;
import com.kulu.wallet.domain.ErrorResponse;
import com.kulu.wallet.domain.Transfer;
import com.kulu.wallet.domain.TransferRequest;
import com.kulu.wallet.domain.TransferResponse;
import com.kulu.wallet.domain.TransferStatus;
import com.kulu.wallet.domain.Wallet;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public class TransferService {
  public static final String OUTBOX_EVENT_TYPE = "TRANSFER_COMPLETED";

  private static final Set<String> SUPPORTED_CURRENCIES = Set.of("AED", "USD", "EUR");

  private final Database database;
  private final WalletRepository walletRepository;
  private final TransferRepository transferRepository;
  private final IdempotencyRepository idempotencyRepository;
  private final EventRepository eventRepository;
  private final ObjectMapper objectMapper;

  public TransferService(Database database, ObjectMapper objectMapper) {
    this.database = database;
    this.objectMapper = objectMapper;
    this.walletRepository = new WalletRepository();
    this.transferRepository = new TransferRepository();
    this.idempotencyRepository = new IdempotencyRepository();
    this.eventRepository = new EventRepository();
  }

  public ServiceResult createTransfer(String idempotencyKey, TransferRequest request) {
    if (idempotencyKey == null || idempotencyKey.isBlank()) {
      return ServiceResult.error(
          400, "missing_idempotency_key", "Idempotency-Key header is required");
    }

    Optional<String> validationError = validateRequest(request);
    if (validationError.isPresent()) {
      return ServiceResult.error(400, "validation_error", validationError.get());
    }

    String requestHash = hashRequest(request);

    try (Connection connection = database.getConnection()) {
      connection.setAutoCommit(false);
      try {
        Optional<IdempotencyRepository.StoredResponse> existing =
            idempotencyRepository.find(connection, idempotencyKey);
        if (existing.isPresent()) {
          IdempotencyRepository.StoredResponse stored = existing.get();
          if (!stored.requestHash().equals(requestHash)) {
            connection.commit();
            return ServiceResult.error(
                409, "idempotency_conflict", "Idempotency-Key was reused with a different payload");
          }
          connection.commit();
          return ServiceResult.replay(stored.httpStatus(), stored.responseBody());
        }

        // Lock wallets in stable id order to reduce deadlock risk under concurrency.
        String firstId =
            request.sourceWalletId().compareTo(request.destinationWalletId()) < 0
                ? request.sourceWalletId()
                : request.destinationWalletId();
        String secondId =
            firstId.equals(request.sourceWalletId())
                ? request.destinationWalletId()
                : request.sourceWalletId();

        Optional<Wallet> firstOpt = walletRepository.findByIdForUpdate(connection, firstId);
        Optional<Wallet> secondOpt = walletRepository.findByIdForUpdate(connection, secondId);

        if (firstOpt.isEmpty() || secondOpt.isEmpty()) {
          connection.commit();
          return ServiceResult.error(
              404, "wallet_not_found", "Source or destination wallet not found");
        }

        // Re-check idempotency after locks so concurrent same-key retries cannot double-debit.
        Optional<IdempotencyRepository.StoredResponse> raced =
            idempotencyRepository.find(connection, idempotencyKey);
        if (raced.isPresent()) {
          IdempotencyRepository.StoredResponse stored = raced.get();
          if (!stored.requestHash().equals(requestHash)) {
            connection.commit();
            return ServiceResult.error(
                409, "idempotency_conflict", "Idempotency-Key was reused with a different payload");
          }
          connection.commit();
          return ServiceResult.replay(stored.httpStatus(), stored.responseBody());
        }

        Wallet source =
            firstOpt.get().id().equals(request.sourceWalletId()) ? firstOpt.get() : secondOpt.get();
        Wallet destination =
            firstOpt.get().id().equals(request.destinationWalletId())
                ? firstOpt.get()
                : secondOpt.get();

        if (!source.currency().equals(request.currency())
            || !destination.currency().equals(request.currency())) {
          connection.commit();
          return ServiceResult.error(
              400, "currency_mismatch", "Wallet currency does not match request");
        }

        if (source.balance() < request.amount()) {
          String transferId = UUID.randomUUID().toString();
          Transfer rejected =
              new Transfer(
                  transferId,
                  request.sourceWalletId(),
                  request.destinationWalletId(),
                  request.amount(),
                  request.currency(),
                  request.reference(),
                  TransferStatus.REJECTED_INSUFFICIENT_FUNDS,
                  Instant.now());
          transferRepository.insert(connection, rejected);
          eventRepository.insertTransferEvent(
              connection,
              transferId,
              "REJECTED_INSUFFICIENT_FUNDS",
              "Insufficient balance on source wallet");
          TransferResponse body = TransferResponse.from(rejected);
          String json = toJson(body);
          idempotencyRepository.insert(
              connection, idempotencyKey, requestHash, transferId, 422, json);
          connection.commit();
          return ServiceResult.of(422, json);
        }

        String transferId = UUID.randomUUID().toString();
        walletRepository.updateBalance(
            connection, source.id(), source.balance() - request.amount(), source.version());
        walletRepository.updateBalance(
            connection,
            destination.id(),
            destination.balance() + request.amount(),
            destination.version());

        Transfer completed =
            new Transfer(
                transferId,
                request.sourceWalletId(),
                request.destinationWalletId(),
                request.amount(),
                request.currency(),
                request.reference(),
                TransferStatus.COMPLETED,
                Instant.now());
        transferRepository.insert(connection, completed);
        eventRepository.insertTransferEvent(
            connection, transferId, "COMPLETED", "Transfer completed successfully");
        eventRepository.insertOutboxEvent(
            connection, transferId, OUTBOX_EVENT_TYPE, toJson(TransferResponse.from(completed)));

        TransferResponse body = TransferResponse.from(completed);
        String json = toJson(body);
        idempotencyRepository.insert(
            connection, idempotencyKey, requestHash, transferId, 201, json);
        connection.commit();
        return ServiceResult.of(201, json);
      } catch (SQLException e) {
        connection.rollback();
        // Concurrent insert on same idempotency key: treat as retry and re-read.
        if (isUniqueViolation(e)) {
          return createTransfer(idempotencyKey, request);
        }
        throw new IllegalStateException("Transfer failed", e);
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to open DB connection", e);
    }
  }

  public Optional<Transfer> getTransfer(String transferId) {
    try (Connection connection = database.getConnection()) {
      return transferRepository.findById(connection, transferId);
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to load transfer", e);
    }
  }

  public Optional<Wallet> getWallet(String walletId) {
    try (Connection connection = database.getConnection()) {
      return walletRepository.findById(connection, walletId);
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to load wallet", e);
    }
  }

  public void seedWallet(String id, String currency, long balance) {
    try (Connection connection = database.getConnection()) {
      walletRepository.insert(connection, new Wallet(id, currency, balance, 0));
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to seed wallet " + id, e);
    }
  }

  private Optional<String> validateRequest(TransferRequest request) {
    if (request == null) {
      return Optional.of("Request body is required");
    }
    if (isBlank(request.sourceWalletId())
        || isBlank(request.destinationWalletId())
        || isBlank(request.currency())
        || isBlank(request.reference())) {
      return Optional.of(
          "source_wallet_id, destination_wallet_id, currency, and reference are required");
    }
    if (request.amount() <= 0) {
      return Optional.of("amount must be a positive integer (minor units)");
    }
    if (request.sourceWalletId().equals(request.destinationWalletId())) {
      return Optional.of("source and destination wallets must differ");
    }
    if (!SUPPORTED_CURRENCIES.contains(request.currency())) {
      return Optional.of("currency is not supported");
    }
    return Optional.empty();
  }

  private String hashRequest(TransferRequest request) {
    try {
      String canonical =
          request.sourceWalletId()
              + "|"
              + request.destinationWalletId()
              + "|"
              + request.amount()
              + "|"
              + request.currency()
              + "|"
              + request.reference();
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hashed = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hashed);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private String toJson(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("JSON serialization failed", e);
    }
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }

  private static boolean isUniqueViolation(SQLException e) {
    String message = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
    return message.contains("unique") || message.contains("primary key");
  }

  public record ServiceResult(int status, String body, boolean replay) {
    public static ServiceResult of(int status, String body) {
      return new ServiceResult(status, body, false);
    }

    public static ServiceResult replay(int status, String body) {
      return new ServiceResult(status, body, true);
    }

    public static ServiceResult error(int status, String error, String message) {
      try {
        String body = new ObjectMapper().writeValueAsString(new ErrorResponse(error, message));
        return new ServiceResult(status, body, false);
      } catch (JsonProcessingException e) {
        throw new IllegalStateException(e);
      }
    }
  }
}
