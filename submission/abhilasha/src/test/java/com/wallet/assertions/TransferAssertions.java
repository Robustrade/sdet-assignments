package com.wallet.assertions;

import com.wallet.client.DatabaseVerificationClient;
import com.wallet.model.TransferRecord;
import io.restassured.response.Response;
import org.assertj.core.api.AbstractAssert;
import org.assertj.core.api.Assertions;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/**
 * Fluent assertion DSL for transfer-level verification.
 *
 * Usage:
 *   TransferAssertions.assertThat(response, dbClient)
 *       .hasStatusCode(200)
 *       .hasTransferId()
 *       .dbRecordHasStatus("success")
 *       .dbRecordHasAmount(new BigDecimal("100.00"));
 */
public class TransferAssertions extends AbstractAssert<TransferAssertions, Response> {

    private final DatabaseVerificationClient dbClient;
    private TransferRecord cachedRecord;

    private TransferAssertions(Response response, DatabaseVerificationClient dbClient) {
        super(response, TransferAssertions.class);
        this.dbClient = dbClient;
    }

    public static TransferAssertions assertThat(Response response, DatabaseVerificationClient dbClient) {
        return new TransferAssertions(response, dbClient);
    }

    // ─── HTTP Response Assertions ─────────────────────────────────────────────

    public TransferAssertions hasStatusCode(int expected) {
        int actual = actual.getStatusCode();
        Assertions.assertThat(actual)
                .as("Expected HTTP status code %d but got %d. Body: %s", expected, actual, actual().getBody().asString())
                .isEqualTo(expected);
        return this;
    }

    public TransferAssertions hasTransferId() {
        String transferId = actual.jsonPath().getString("transfer_id");
        Assertions.assertThat(transferId)
                .as("Expected response to contain a non-null transfer_id")
                .isNotNull()
                .isNotBlank();
        return this;
    }

    public TransferAssertions hasResponseStatus(String expected) {
        String status = actual.jsonPath().getString("status");
        Assertions.assertThat(status)
                .as("Expected response.status = '%s' but got '%s'", expected, status)
                .isEqualTo(expected);
        return this;
    }

    public TransferAssertions hasErrorCode(String expected) {
        String errorCode = actual.jsonPath().getString("error_code");
        Assertions.assertThat(errorCode)
                .as("Expected error_code = '%s' but got '%s'", expected, errorCode)
                .isEqualTo(expected);
        return this;
    }

    public TransferAssertions hasFieldError(String fieldName) {
        List<String> fields = actual.jsonPath().getList("errors.field");
        Assertions.assertThat(fields)
                .as("Expected non-null errors array with field error for '%s'. Body: %s",
                        fieldName, actual.getBody().asString())
                .isNotNull()
                .isNotEmpty()
                .contains(fieldName);
        return this;
    }

    public TransferAssertions hasNoFieldErrors() {
        List<?> errors = actual.jsonPath().getList("errors");
        Assertions.assertThat(errors)
                .as("Expected no field errors but found: %s", errors)
                .isNullOrEmpty();
        return this;
    }

    public TransferAssertions hasIdempotencyKeyHeader(String expected) {
        String header = actual.getHeader("Idempotency-Key");
        Assertions.assertThat(header)
                .as("Expected Idempotency-Key header = '%s' but got '%s'", expected, header)
                .isEqualTo(expected);
        return this;
    }

    // ─── Database Assertions ──────────────────────────────────────────────────

    public TransferAssertions dbRecordExists() {
        TransferRecord record = loadTransferRecord();
        Assertions.assertThat(record)
                .as("Expected transfer record to exist in DB for transfer_id=%s",
                        actual.jsonPath().getString("transfer_id"))
                .isNotNull();
        return this;
    }

    public TransferAssertions dbRecordHasStatus(String expected) {
        TransferRecord record = loadTransferRecord();
        Assertions.assertThat(record.getStatus())
                .as("Expected DB transfer.status = '%s' but got '%s' (transfer_id=%s)",
                        expected, record.getStatus(), record.getId())
                .isEqualTo(expected);
        return this;
    }

    public TransferAssertions dbRecordHasAmount(BigDecimal expected) {
        TransferRecord record = loadTransferRecord();
        Assertions.assertThat(record.getAmount().stripTrailingZeros())
                .as("Expected DB transfer.amount = %s but got %s", expected, record.getAmount())
                .isEqualTo(expected.stripTrailingZeros());
        return this;
    }

    public TransferAssertions dbRecordHasCurrency(String expected) {
        TransferRecord record = loadTransferRecord();
        Assertions.assertThat(record.getCurrency())
                .as("Expected DB transfer.currency = '%s' but got '%s'", expected, record.getCurrency())
                .isEqualTo(expected);
        return this;
    }

    public TransferAssertions dbRecordHasReference(String expected) {
        TransferRecord record = loadTransferRecord();
        Assertions.assertThat(record.getReference())
                .as("Expected DB transfer.reference = '%s' but got '%s'", expected, record.getReference())
                .isEqualTo(expected);
        return this;
    }

    public TransferAssertions dbRecordHasIdempotencyKey(String expected) {
        TransferRecord record = loadTransferRecord();
        Assertions.assertThat(record.getIdempotencyKey())
                .as("Expected DB transfer.idempotency_key = '%s' but got '%s'",
                        expected, record.getIdempotencyKey())
                .isEqualTo(expected);
        return this;
    }

    public TransferAssertions dbHasAuditEvents(String... expectedEventTypes) {
        String transferId = extractTransferId();
        List<String> actualTypes = dbClient.getTransferEventTypes(transferId);
        Assertions.assertThat(actualTypes)
                .as("Expected audit events %s for transfer %s but got %s",
                        List.of(expectedEventTypes), transferId, actualTypes)
                .containsExactly(expectedEventTypes);
        return this;
    }

    public TransferAssertions dbHasAtLeastOneAuditEvent() {
        String transferId = extractTransferId();
        int count = dbClient.countTransferEvents(transferId);
        Assertions.assertThat(count)
                .as("Expected at least one audit event for transfer %s", transferId)
                .isGreaterThan(0);
        return this;
    }

    public TransferAssertions dbHasOutboxEvent() {
        String transferId = extractTransferId();
        int count = dbClient.countOutboxEventsByAggregateId(transferId);
        Assertions.assertThat(count)
                .as("Expected at least one outbox event for transfer %s", transferId)
                .isGreaterThan(0);
        return this;
    }

    public TransferAssertions dbHasExactlyOneTransferRecord() {
        String idempotencyKey = actual.jsonPath().getString("idempotency_key");
        Assertions.assertThat(idempotencyKey)
                .as("Cannot assert exactly-one-transfer-record: response has no idempotency_key field")
                .isNotNull();
        int count = dbClient.countTransfersByIdempotencyKey(idempotencyKey);
        Assertions.assertThat(count)
                .as("Expected exactly 1 transfer record for idempotency_key=%s but found %d",
                        idempotencyKey, count)
                .isEqualTo(1);
        return this;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    private TransferRecord loadTransferRecord() {
        if (cachedRecord != null) return cachedRecord;
        String transferId = extractTransferId();
        Optional<TransferRecord> record = dbClient.findTransferById(transferId);
        Assertions.assertThat(record)
                .as("No transfer record in DB for transfer_id=%s", transferId)
                .isPresent();
        cachedRecord = record.get();
        return cachedRecord;
    }

    private String extractTransferId() {
        String transferId = actual.jsonPath().getString("transfer_id");
        Assertions.assertThat(transferId)
                .as("Cannot verify DB state: response has no transfer_id")
                .isNotNull();
        return transferId;
    }
}
