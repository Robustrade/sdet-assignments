package com.wallet.assertions;

import com.wallet.db.IdempotencyRepository;
import com.wallet.db.TransferRepository;
import com.wallet.db.WalletRepository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Fluent DB-level assertion helpers.
 * Validates persisted state — not just API responses.
 */
public class DatabaseAssertions {

    private final WalletRepository     wallets;
    private final TransferRepository   transfers;
    private final IdempotencyRepository idempotency;

    public DatabaseAssertions(WalletRepository wallets,
                               TransferRepository transfers,
                               IdempotencyRepository idempotency) {
        this.wallets     = wallets;
        this.transfers   = transfers;
        this.idempotency = idempotency;
    }

    // ── Wallet balance invariants ─────────────────────────

    public DatabaseAssertions walletBalanceEquals(String walletId, BigDecimal expected) {
        BigDecimal actual = wallets.getBalance(walletId);
        assertThat(actual)
                .as("Wallet [%s] balance: expected %s but was %s", walletId, expected, actual)
                .isEqualByComparingTo(expected);
        return this;
    }

    public DatabaseAssertions walletBalanceDecreasedBy(String walletId,
                                                        BigDecimal before,
                                                        BigDecimal amount) {
        BigDecimal expected = before.subtract(amount);
        return walletBalanceEquals(walletId, expected);
    }

    public DatabaseAssertions walletBalanceIncreasedBy(String walletId,
                                                        BigDecimal before,
                                                        BigDecimal amount) {
        BigDecimal expected = before.add(amount);
        return walletBalanceEquals(walletId, expected);
    }

    public DatabaseAssertions walletBalanceUnchanged(String walletId, BigDecimal before) {
        return walletBalanceEquals(walletId, before);
    }

    // ── Transfer row invariants ───────────────────────────

    public DatabaseAssertions transferExistsWithStatus(String transferId, String status) {
        Optional<Map<String, Object>> row = transfers.findById(transferId);
        assertThat(row).as("Transfer [%s] must exist in DB", transferId).isPresent();
        assertThat(row.get().get("status"))
                .as("Transfer [%s] status", transferId)
                .isEqualTo(status);
        return this;
    }

    public DatabaseAssertions transferDoesNotExist(String transferId) {
        assertThat(transfers.findById(transferId))
                .as("Transfer [%s] should NOT exist in DB", transferId)
                .isEmpty();
        return this;
    }

    public DatabaseAssertions onlyOneTransferExistsForIdempotencyKey(String key) {
        List<Map<String, Object>> rows = transfers.findByIdempotencyKey(key);
        assertThat(rows)
                .as("Exactly 1 transfer row must exist for idempotency key [%s]", key)
                .hasSize(1);
        return this;
    }

    public DatabaseAssertions noTransferExistsForIdempotencyKey(String key) {
        List<Map<String, Object>> rows = transfers.findByIdempotencyKey(key);
        assertThat(rows)
                .as("No transfer row should exist for idempotency key [%s]", key)
                .isEmpty();
        return this;
    }

    // ── Idempotency key invariants ────────────────────────

    public DatabaseAssertions idempotencyKeyExists(String key) {
        assertThat(idempotency.exists(key))
                .as("Idempotency key [%s] should exist in DB", key)
                .isTrue();
        return this;
    }

    public DatabaseAssertions idempotencyKeyStatus(String key, String expectedStatus) {
        assertThat(idempotency.getStatus(key))
                .as("Idempotency key [%s] status", key)
                .isEqualTo(expectedStatus);
        return this;
    }

    // ── Audit / event invariants ──────────────────────────

    public DatabaseAssertions transferHasEvent(String transferId, String eventType) {
        List<Map<String, Object>> events = transfers.findEventsByTransferId(transferId);
        boolean found = events.stream()
                .anyMatch(e -> eventType.equals(e.get("event_type")));
        assertThat(found)
                .as("Transfer [%s] should have event [%s]. Found: %s", transferId, eventType, events)
                .isTrue();
        return this;
    }

    public DatabaseAssertions transferHasExactlyOneOutboxEvent(String transferId) {
        List<Map<String, Object>> outbox = transfers.findOutboxByTransferId(transferId);
        assertThat(outbox)
                .as("Transfer [%s] should have exactly 1 outbox event", transferId)
                .hasSize(1);
        return this;
    }

    public DatabaseAssertions outboxEventTypeEquals(String transferId, String eventType) {
        List<Map<String, Object>> outbox = transfers.findOutboxByTransferId(transferId);
        assertThat(outbox).as("No outbox events found for transfer [%s]", transferId).isNotEmpty();
        assertThat(outbox.get(0).get("event_type"))
                .as("Outbox event_type for transfer [%s]", transferId)
                .isEqualTo(eventType);
        return this;
    }
}

