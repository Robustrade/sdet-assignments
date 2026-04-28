package com.wallet.db;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Queries against the transfers table (and its related event/outbox tables).
 * Mainly used to verify what the service actually wrote to the DB after an API call.
 */
public class TransferRepository {

    private final DbClient db;

    public TransferRepository(DbClient db) {
        this.db = db;
    }

    // look up a transfer by its primary key
    public Optional<Map<String, Object>> findById(String transferId) {
        List<Map<String, Object>> rows =
                db.query("SELECT * FROM transfers WHERE id = ?", transferId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<Map<String, Object>> findByIdempotencyKey(String key) {
        return db.query("SELECT * FROM transfers WHERE idempotency_key = ?", key);
    }

    /** How many transfers has this wallet sent? Used in some assertion helpers. */
    public int countBySourceWallet(String walletId) {
        Map<String, Object> row = db.queryOne(
                "SELECT COUNT(*) AS cnt FROM transfers WHERE source_wallet_id = ?", walletId);
        return ((Number) row.get("cnt")).intValue();
    }

    /** Count COMPLETED transfers for a given idempotency key — should always be 0 or 1. */
    public int countCompletedByIdempotencyKey(String key) {
        Map<String, Object> row = db.queryOne(
                "SELECT COUNT(*) AS cnt FROM transfers WHERE idempotency_key = ? AND status = 'COMPLETED'",
                key);
        return ((Number) row.get("cnt")).intValue();
    }

    /** Pulls all audit events for a transfer in order — used to check the event trail. */
    public List<Map<String, Object>> findEventsByTransferId(String transferId) {
        // ordered by id so we get them in chronological order
        return db.query("SELECT * FROM transfer_events WHERE transfer_id = ? ORDER BY id", transferId);
    }

    /** Outbox events for a transfer — downstream consumers read from here. */
    public List<Map<String, Object>> findOutboxByTransferId(String transferId) {
        return db.query("SELECT * FROM outbox_events WHERE transfer_id = ? ORDER BY id", transferId);
    }

    /** Wipes a transfer and all its related rows — used in test teardown. */
    public void deleteByIdempotencyKey(String key) {
        // clean up events first because of FK constraints, then the transfer row
        List<Map<String, Object>> rows = findByIdempotencyKey(key);
        rows.forEach(r -> {
            String id = (String) r.get("id");
            db.execute("DELETE FROM transfer_events WHERE transfer_id = ?", id);
            db.execute("DELETE FROM outbox_events    WHERE transfer_id = ?", id);
        });
        db.execute("DELETE FROM transfers WHERE idempotency_key = ?", key);
    }
}

