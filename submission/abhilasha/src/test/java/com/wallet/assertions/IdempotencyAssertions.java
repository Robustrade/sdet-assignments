package com.wallet.assertions;

import com.wallet.client.DatabaseVerificationClient;
import com.wallet.model.TransferRecord;
import io.restassured.response.Response;
import org.assertj.core.api.Assertions;

import java.util.Optional;

/**
 * Assertions focused on idempotency guarantees:
 *   1. Same key → same transfer_id, same status
 *   2. Same key + different payload → 409 Conflict
 *   3. Exactly one DB row per idempotency key
 *   4. No duplicate balance mutations
 */
public class IdempotencyAssertions {

    private final DatabaseVerificationClient dbClient;

    public IdempotencyAssertions(DatabaseVerificationClient dbClient) {
        this.dbClient = dbClient;
    }

    public static IdempotencyAssertions assertThat(DatabaseVerificationClient dbClient) {
        return new IdempotencyAssertions(dbClient);
    }

    /**
     * Verifies that a repeated request returned the same transfer_id as the original.
     */
    public IdempotencyAssertions duplicateRequestReturnsSameTransferId(
            Response originalResponse, Response duplicateResponse) {

        String originalId  = originalResponse.jsonPath().getString("transfer_id");
        String duplicateId = duplicateResponse.jsonPath().getString("transfer_id");

        Assertions.assertThat(duplicateId)
                .as("Duplicate request with same idempotency key must return same transfer_id. " +
                    "Original=%s, Duplicate=%s", originalId, duplicateId)
                .isEqualTo(originalId);

        return this;
    }

    /**
     * Verifies that a repeated request returned the same HTTP status code.
     */
    public IdempotencyAssertions duplicateRequestReturnsSameStatusCode(
            Response originalResponse, Response duplicateResponse) {

        int originalStatus  = originalResponse.getStatusCode();
        int duplicateStatus = duplicateResponse.getStatusCode();

        Assertions.assertThat(duplicateStatus)
                .as("Duplicate request must return same HTTP status. Original=%d, Duplicate=%d",
                        originalStatus, duplicateStatus)
                .isEqualTo(originalStatus);

        return this;
    }

    /**
     * Verifies exactly one transfer row exists in DB for this idempotency key.
     * Guards against phantom double-writes under race conditions.
     */
    public IdempotencyAssertions exactlyOneTransferPerKey(String idempotencyKey) {
        int count = dbClient.countTransfersByIdempotencyKey(idempotencyKey);
        Assertions.assertThat(count)
                .as("Expected exactly 1 transfer row for idempotency_key=%s but found %d (duplicate write!)",
                        idempotencyKey, count)
                .isEqualTo(1);
        return this;
    }

    /**
     * Verifies the idempotency_keys table has a record for this key.
     */
    public IdempotencyAssertions keyPersistedInDb(String idempotencyKey) {
        boolean exists = dbClient.idempotencyKeyExists(idempotencyKey);
        Assertions.assertThat(exists)
                .as("Expected idempotency key '%s' to be persisted in idempotency_keys table",
                        idempotencyKey)
                .isTrue();
        return this;
    }

    /**
     * Verifies that the conflict response has HTTP 409 and appropriate error.
     */
    public IdempotencyAssertions conflictResponseIsCorrect(Response conflictResponse) {
        Assertions.assertThat(conflictResponse.getStatusCode())
                .as("Idempotency conflict must return HTTP 409 but got %d. Body: %s",
                        conflictResponse.getStatusCode(), conflictResponse.getBody().asString())
                .isEqualTo(409);

        String errorCode = conflictResponse.jsonPath().getString("error_code");
        Assertions.assertThat(errorCode)
                .as("Expected error_code for conflict but got null. Body: %s",
                        conflictResponse.getBody().asString())
                .isNotNull();

        return this;
    }

    /**
     * Given an idempotency key, verifies the DB transfer record matches the expected transfer ID.
     */
    public IdempotencyAssertions dbTransferMatchesOriginal(String idempotencyKey, String expectedTransferId) {
        Optional<TransferRecord> record = dbClient.findTransferByIdempotencyKey(idempotencyKey);
        Assertions.assertThat(record)
                .as("Expected transfer record for idempotency_key=%s but none found", idempotencyKey)
                .isPresent();
        Assertions.assertThat(record.get().getId())
                .as("DB transfer for key=%s: expected id=%s but got %s",
                        idempotencyKey, expectedTransferId, record.get().getId())
                .isEqualTo(expectedTransferId);
        return this;
    }
}
