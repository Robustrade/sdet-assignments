package com.kulu.sdet.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kulu.sdet.domain.ApiError;
import com.kulu.sdet.domain.TransferRequest;
import com.kulu.sdet.domain.TransferStatus;
import com.kulu.sdet.domain.TransferView;
import com.kulu.sdet.domain.WalletView;
import com.kulu.sdet.repo.AuditRepo;
import com.kulu.sdet.repo.IdempotencyRepo;
import com.kulu.sdet.repo.OutboxRepo;
import com.kulu.sdet.repo.TransferRepo;
import com.kulu.sdet.repo.WalletRepo;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Core transfer workflow. All observable side effects — wallet balance mutation, transfer row,
 * audit entry, and outbox row — happen inside a single transaction so that either the complete set
 * is persisted or none of it is.
 *
 * <p>Concurrency correctness relies on two mechanisms:
 *
 * <ul>
 *   <li><b>Idempotency race:</b> the idempotency row is inserted <em>first</em>, before any balance
 *       mutation. Concurrent requests carrying the same key block on the unique-index insert until
 *       the winner commits, at which point losers see the winner's persisted response and replay it
 *       verbatim. This guarantees exactly one set of side effects per key.
 *   <li><b>Balance race:</b> wallet rows are acquired with {@code SELECT ... FOR UPDATE} in a
 *       deterministic order (lexicographic on wallet id) so competing transfers serialize on the
 *       shared source wallet without deadlocking, and every debit re-reads the freshly-locked
 *       balance before mutating.
 * </ul>
 */
@Service
public class TransferService {

  public static final Set<String> VALID_CURRENCIES = Set.of("AED", "USD", "EUR", "GBP");

  private final WalletRepo wallets;
  private final TransferRepo transfers;
  private final IdempotencyRepo idempotency;
  private final OutboxRepo outbox;
  private final AuditRepo audit;
  private final ObjectMapper mapper;

  public TransferService(
      WalletRepo wallets,
      TransferRepo transfers,
      IdempotencyRepo idempotency,
      OutboxRepo outbox,
      AuditRepo audit,
      ObjectMapper mapper) {
    this.wallets = wallets;
    this.transfers = transfers;
    this.idempotency = idempotency;
    this.outbox = outbox;
    this.audit = audit;
    this.mapper = mapper;
  }

  public sealed interface Result {
    int status();

    Object body();

    record Ok(int status, TransferView view) implements Result {
      @Override
      public Object body() {
        return view;
      }
    }

    record Err(int status, ApiError error) implements Result {
      @Override
      public Object body() {
        return error;
      }
    }
  }

  /** A replay of a previously stored response body — sent to the client verbatim. */
  public record PersistedReplay(int status, String bodyJson) implements Result {
    @Override
    public Object body() {
      return bodyJson;
    }
  }

  /**
   * Execute a transfer request. Idempotent by {@code idempotencyKey} — replays of the same key with
   * the same payload return the original persisted response verbatim; replays with a different
   * payload return 409.
   */
  @Transactional
  public Result execute(TransferRequest req, String idempotencyKey) {

    Result validation = validate(req);
    if (validation != null) {
      // Pure input-validation errors are stateless; do not persist an idempotency record for them.
      return validation;
    }

    String payloadHash = payloadHash(req);
    boolean hasKey = idempotencyKey != null && !idempotencyKey.isBlank();

    if (hasKey) {
      Optional<IdempotencyRepo.Record> existing = idempotency.find(idempotencyKey);
      if (existing.isPresent()) {
        return replay(existing.get(), payloadHash);
      }
      // Claim the key before any side effect. Concurrent duplicates will block on the unique
      // index insert until we commit (or rollback), then see our persisted response and replay.
      try {
        idempotency.insertPlaceholder(idempotencyKey, payloadHash);
      } catch (DuplicateKeyException dup) {
        IdempotencyRepo.Record winner = idempotency.find(idempotencyKey).orElseThrow();
        return replay(winner, payloadHash);
      }
    }

    Result outcome = performTransfer(req, idempotencyKey);

    if (hasKey) {
      String transferId = outcome instanceof Result.Ok ok ? ok.view().id() : null;
      idempotency.updateResult(
          idempotencyKey, transferId, outcome.status(), toJson(outcome.body()));
    }
    return outcome;
  }

  private Result performTransfer(TransferRequest req, String idempotencyKey) {
    // Deterministic lock order to avoid deadlocks between competing transfers.
    String first =
        req.sourceWalletId().compareTo(req.destinationWalletId()) < 0
            ? req.sourceWalletId()
            : req.destinationWalletId();
    String second =
        first.equals(req.sourceWalletId()) ? req.destinationWalletId() : req.sourceWalletId();

    Optional<WalletView> firstLocked = wallets.lockById(first);
    Optional<WalletView> secondLocked = wallets.lockById(second);

    Optional<WalletView> source = req.sourceWalletId().equals(first) ? firstLocked : secondLocked;
    Optional<WalletView> destination =
        req.destinationWalletId().equals(first) ? firstLocked : secondLocked;

    if (source.isEmpty()) {
      return new Result.Err(422, ApiError.of("source_wallet_not_found", "source wallet not found"));
    }
    if (destination.isEmpty()) {
      return new Result.Err(
          422, ApiError.of("destination_wallet_not_found", "destination wallet not found"));
    }
    if (!source.get().currency().equals(req.currency())) {
      return new Result.Err(
          422, ApiError.of("currency_mismatch", "source wallet currency mismatch"));
    }
    if (source.get().balance() < req.amount()) {
      return new Result.Err(
          422, ApiError.of("insufficient_balance", "source wallet has insufficient balance"));
    }

    wallets.debit(req.sourceWalletId(), req.amount());
    wallets.credit(req.destinationWalletId(), req.amount());

    String transferId = UUID.randomUUID().toString();
    Instant now = Instant.now();
    TransferView view =
        new TransferView(
            transferId,
            req.sourceWalletId(),
            req.destinationWalletId(),
            req.amount(),
            req.currency(),
            req.reference(),
            TransferStatus.COMPLETED.wire(),
            idempotencyKey,
            now);
    transfers.insert(view);
    audit.append(
        transferId,
        "transfer_completed",
        toJson(
            Map.of(
                "amount", req.amount(),
                "currency", req.currency(),
                "source", req.sourceWalletId(),
                "destination", req.destinationWalletId())));

    outbox.enqueueIfAbsent(
        transferId,
        "TransferCompleted",
        toJson(
            Map.of(
                "transfer_id", transferId,
                "source_wallet_id", req.sourceWalletId(),
                "destination_wallet_id", req.destinationWalletId(),
                "amount", req.amount(),
                "currency", req.currency())));

    return new Result.Ok(201, view);
  }

  private Result validate(TransferRequest req) {
    if (req == null) {
      return new Result.Err(422, ApiError.of("invalid_payload", "request body required"));
    }
    if (req.sourceWalletId() == null
        || req.destinationWalletId() == null
        || req.amount() == null
        || req.currency() == null) {
      return new Result.Err(
          422,
          ApiError.of(
              "missing_fields",
              "source_wallet_id, destination_wallet_id, amount and currency are required"));
    }
    if (!VALID_CURRENCIES.contains(req.currency())) {
      return new Result.Err(
          422, ApiError.of("invalid_currency", "currency must be one of " + VALID_CURRENCIES));
    }
    if (req.amount() <= 0) {
      return new Result.Err(422, ApiError.of("invalid_amount", "amount must be positive"));
    }
    if (req.sourceWalletId().equals(req.destinationWalletId())) {
      return new Result.Err(
          422, ApiError.of("same_wallet", "source and destination must be different"));
    }
    return null;
  }

  private Result replay(IdempotencyRepo.Record existing, String payloadHash) {
    if (!existing.payloadHash().equals(payloadHash)) {
      return new Result.Err(
          409,
          ApiError.of(
              "idempotency_key_conflict",
              "idempotency key was used previously with a different payload"));
    }
    return new PersistedReplay(existing.responseStatus(), existing.responseBody());
  }

  private String toJson(Object obj) {
    if (obj instanceof String s) {
      return s;
    }
    try {
      return mapper.writeValueAsString(obj);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("failed to serialize " + obj, e);
    }
  }

  private String payloadHash(TransferRequest req) {
    Map<String, Object> canonical = new TreeMap<>();
    canonical.put("source_wallet_id", req.sourceWalletId());
    canonical.put("destination_wallet_id", req.destinationWalletId());
    canonical.put("amount", req.amount());
    canonical.put("currency", req.currency());
    canonical.put("reference", req.reference());
    try {
      String json = mapper.writeValueAsString(canonical);
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(json.getBytes(StandardCharsets.UTF_8)));
    } catch (JsonProcessingException | NoSuchAlgorithmException e) {
      throw new IllegalStateException("failed to hash payload", e);
    }
  }
}
