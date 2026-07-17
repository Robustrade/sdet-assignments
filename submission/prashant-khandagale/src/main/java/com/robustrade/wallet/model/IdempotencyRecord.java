package com.robustrade.wallet.model;

import java.time.Instant;

/**
 * One row per Idempotency-Key ever seen.
 *
 * requestHash is a hash of the normalized request body. On replay we compare
 * the hash of the incoming request to the stored hash:
 *  - match      -> return the stored response verbatim, do not re-run business logic
 *  - mismatch   -> reject with 409 (key reused for a different payload)
 *
 * responseStatus / responseBody capture exactly what the client received the
 * first time (including business rejections like insufficient balance), so a
 * replay is byte-for-byte consistent with the original call.
 */
public class IdempotencyRecord {

    private final String idempotencyKey;
    private final String requestHash;
    private final int responseStatus;
    private final String responseBody;
    private final String transferId; // null if the original call was rejected before a transfer row existed
    private final Instant createdAt;

    public IdempotencyRecord(String idempotencyKey, String requestHash, int responseStatus,
                              String responseBody, String transferId, Instant createdAt) {
        this.idempotencyKey = idempotencyKey;
        this.requestHash = requestHash;
        this.responseStatus = responseStatus;
        this.responseBody = responseBody;
        this.transferId = transferId;
        this.createdAt = createdAt;
    }

    public String getIdempotencyKey() { return idempotencyKey; }
    public String getRequestHash() { return requestHash; }
    public int getResponseStatus() { return responseStatus; }
    public String getResponseBody() { return responseBody; }
    public String getTransferId() { return transferId; }
    public Instant getCreatedAt() { return createdAt; }
}
