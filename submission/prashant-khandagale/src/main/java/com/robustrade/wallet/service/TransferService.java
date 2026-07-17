package com.robustrade.wallet.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.robustrade.wallet.dao.IdempotencyDao;
import com.robustrade.wallet.dao.OutboxEventDao;
import com.robustrade.wallet.dao.TransferDao;
import com.robustrade.wallet.dao.TransferEventDao;
import com.robustrade.wallet.dao.WalletDao;
import com.robustrade.wallet.db.Database;
import com.robustrade.wallet.dto.ErrorResponseDto;
import com.robustrade.wallet.dto.TransferRequestDto;
import com.robustrade.wallet.dto.TransferResponseDto;
import com.robustrade.wallet.model.IdempotencyRecord;
import com.robustrade.wallet.model.Transfer;
import com.robustrade.wallet.model.TransferStatus;
import com.robustrade.wallet.model.Wallet;
import com.robustrade.wallet.service.exception.IdempotencyConflictException;
import com.robustrade.wallet.service.exception.ValidationException;
import com.robustrade.wallet.service.exception.WalletNotFoundException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

public class TransferService {

    private final Database db;
    private final WalletDao walletDao = new WalletDao();
    private final TransferDao transferDao = new TransferDao();
    private final IdempotencyDao idempotencyDao = new IdempotencyDao();
    private final TransferEventDao eventDao = new TransferEventDao();
    private final OutboxEventDao outboxDao = new OutboxEventDao();
    private final ObjectMapper mapper = new ObjectMapper();

    public TransferService(Database db) {
        this.db = db;
    }

    public ServiceResult createTransfer(TransferRequestDto request, String idempotencyKey) {
        // 1) Cheap, transaction-free validation first. Malformed requests never
        //    touch the idempotency table or open a DB transaction at all.
        try {
            basicValidate(request, idempotencyKey);
        } catch (ValidationException e) {
            return new ServiceResult(400, new ErrorResponseDto("VALIDATION_ERROR", e.getMessage()));
        }

        String requestHash = sha256(request.canonicalForm());
        boolean hasKey = idempotencyKey != null && !idempotencyKey.isBlank();

        try (Connection conn = db.getConnection()) {
            conn.setAutoCommit(false);
            boolean claimedKey = false;
            try {
                if (hasKey) {
                    // This may BLOCK here if another in-flight request already
                    // holds this key -- that's the DB's row lock doing the work
                    // of a mutex for us. See IdempotencyDao#tryClaim.
                    claimedKey = idempotencyDao.tryClaim(conn, idempotencyKey, requestHash);
                    if (!claimedKey) {
                        rollbackQuietly(conn);
                        return replayOrConflict(idempotencyKey, requestHash);
                    }
                }

                ServiceResult result = runBusinessLogic(conn, request);

                if (hasKey) {
                    String transferId = (result.body instanceof TransferResponseDto dto) ? dto.transferId : null;
                    idempotencyDao.finalizeRecord(conn, idempotencyKey, result.statusCode,
                            toJson(result.body), transferId);
                }

                conn.commit();
                return result;

            } catch (WalletNotFoundException | ValidationException e) {
                rollbackQuietly(conn);
                int status = (e instanceof WalletNotFoundException) ? 404 : 400;
                return new ServiceResult(status, new ErrorResponseDto("VALIDATION_ERROR", e.getMessage()));
            } catch (Exception e) {
                rollbackQuietly(conn);
                throw new RuntimeException("Unexpected failure while processing transfer", e);
            }
        } catch (SQLException e) {
            throw new RuntimeException("Database error while processing transfer", e);
        }
    }

    /** Rolls back and swallows any secondary SQLException -- we're already on an error path. */
    private void rollbackQuietly(Connection conn) {
        try {
            conn.rollback();
        } catch (SQLException ignored) {
            // best-effort only; the connection is closed by try-with-resources regardless
        }
    }

    /**
     * Runs the actual money-movement logic inside the caller's transaction.
     * Wallets are locked in a deterministic order (sorted by id) so that two
     * transfers referencing the same pair of wallets never deadlock waiting
     * on each other's locks.
     */
    private ServiceResult runBusinessLogic(Connection conn, TransferRequestDto req) throws SQLException {
        String first = req.sourceWalletId.compareTo(req.destinationWalletId) < 0
                ? req.sourceWalletId : req.destinationWalletId;
        String second = req.sourceWalletId.compareTo(req.destinationWalletId) < 0
                ? req.destinationWalletId : req.sourceWalletId;

        Wallet firstLocked = walletDao.lockForUpdate(conn, first)
                .orElseThrow(() -> new WalletNotFoundException("Wallet not found: " + first));
        Wallet secondLocked = walletDao.lockForUpdate(conn, second)
                .orElseThrow(() -> new WalletNotFoundException("Wallet not found: " + second));

        Wallet source = req.sourceWalletId.equals(first) ? firstLocked : secondLocked;
        Wallet destination = req.sourceWalletId.equals(first) ? secondLocked : firstLocked;

        if (!source.getCurrency().equals(req.currency) || !destination.getCurrency().equals(req.currency)) {
            throw new ValidationException("Wallet currency does not match request currency");
        }

        String transferId = UUID.randomUUID().toString();
        Instant now = Instant.now();

        if (source.getBalance().compareTo(req.amount) < 0) {
            Transfer rejected = new Transfer(transferId, req.sourceWalletId, req.destinationWalletId,
                    req.amount, req.currency, req.reference, TransferStatus.REJECTED,
                    "INSUFFICIENT_BALANCE", now);
            transferDao.insert(conn, rejected);
            eventDao.insert(conn, transferId, "TRANSFER_REJECTED",
                    "Insufficient balance in source wallet " + req.sourceWalletId);
            // No wallet mutation, no outbox event: nothing downstream needs to react to.
            return new ServiceResult(200, toResponseDto(rejected, false));
        }

        walletDao.updateBalance(conn, source.getId(), source.getBalance().subtract(req.amount));
        walletDao.updateBalance(conn, destination.getId(), destination.getBalance().add(req.amount));

        Transfer completed = new Transfer(transferId, req.sourceWalletId, req.destinationWalletId,
                req.amount, req.currency, req.reference, TransferStatus.COMPLETED, null, now);
        transferDao.insert(conn, completed);
        eventDao.insert(conn, transferId, "TRANSFER_CREATED", "Transfer accepted for processing");
        eventDao.insert(conn, transferId, "TRANSFER_COMPLETED", "Funds moved successfully");

        String outboxPayload = "{\"transfer_id\":\"" + transferId + "\",\"amount\":" + req.amount
                + ",\"currency\":\"" + req.currency + "\"}";
        outboxDao.insert(conn, transferId, "TRANSFER_COMPLETED", outboxPayload, "PUBLISHED");

        return new ServiceResult(200, toResponseDto(completed, false));
    }

    /** Handles a duplicate submission once we know a row for this key already exists. */
    private ServiceResult replayOrConflict(String idempotencyKey, String requestHash) throws SQLException {
        try (Connection conn = db.getConnection()) {
            Optional<IdempotencyRecord> existing = idempotencyDao.findByKey(conn, idempotencyKey);
            if (existing.isEmpty()) {
                // Extremely unlikely race (claim failed but row vanished) -- fail safe.
                throw new IdempotencyConflictException("Idempotency key is currently being processed, please retry");
            }
            IdempotencyRecord record = existing.get();
            if (!record.getRequestHash().equals(requestHash)) {
                return new ServiceResult(409, new ErrorResponseDto("IDEMPOTENCY_KEY_REUSED",
                        "Idempotency-Key was already used with a different request payload"));
            }
            try {
                return new ServiceResult(record.getResponseStatus(), markReplayed(record));
            } catch (Exception e) {
                throw new RuntimeException("Failed to parse stored idempotent response", e);
            }
        }
    }

    private Object markReplayed(IdempotencyRecord record) throws Exception {
        if (record.getTransferId() == null) {
            // The original call was rejected before validation could persist a transfer
            // (e.g. malformed currency) -- replay the raw stored error body.
            return mapper.readValue(record.getResponseBody(), ErrorResponseDto.class);
        }
        TransferResponseDto dto = mapper.readValue(record.getResponseBody(), TransferResponseDto.class);
        dto.replayed = true;
        return dto;
    }

    private void basicValidate(TransferRequestDto req, String idempotencyKey) {
        if (isBlank(req.sourceWalletId)) throw new ValidationException("source_wallet_id is required");
        if (isBlank(req.destinationWalletId)) throw new ValidationException("destination_wallet_id is required");
        if (isBlank(req.currency) || req.currency.length() != 3) {
            throw new ValidationException("currency must be a 3-letter ISO currency code");
        }
        if (req.amount == null || req.amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new ValidationException("amount must be a positive number");
        }
        if (req.sourceWalletId.equals(req.destinationWalletId)) {
            throw new ValidationException("source_wallet_id and destination_wallet_id must differ");
        }
        if (idempotencyKey != null && idempotencyKey.isBlank()) {
            throw new ValidationException("Idempotency-Key header, if present, must not be blank");
        }
    }

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private TransferResponseDto toResponseDto(Transfer t, boolean replayed) {
        TransferResponseDto dto = new TransferResponseDto();
        dto.transferId = t.getId();
        dto.status = t.getStatus().name();
        dto.sourceWalletId = t.getSourceWalletId();
        dto.destinationWalletId = t.getDestinationWalletId();
        dto.amount = t.getAmount();
        dto.currency = t.getCurrency();
        dto.reference = t.getReference();
        dto.rejectionReason = t.getRejectionReason();
        dto.createdAt = t.getCreatedAt().toString();
        dto.replayed = replayed;
        return dto;
    }

    private String toJson(Object o) {
        try {
            return mapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize response for idempotency storage", e);
        }
    }

    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }
}
