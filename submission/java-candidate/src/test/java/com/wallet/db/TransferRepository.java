package com.wallet.db;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Repository for transfers table queries used in DB assertions.
 */
public class TransferRepository {

    private final DbClient db;

    public TransferRepository(DbClient db) {
        this.db = db;
    }

    public Optional<Map<String, Object>> findById(String transferId) {
        List<Map<String, Object>> rows =
                db.query("SELECT * FROM transfers WHERE id = ?", transferId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<Map<String, Object>> findByIdempotencyKey(String key) {
        return db.query("SELECT * FROM transfers WHERE idempotency_key = ?", key);
    }

    /** Count transfer rows touching the given source wallet. */
    public int countBySourceWallet(String walletId) {
        Map<String, Object> row = db.queryOne(
                "SELECT COUNT(*) AS cnt FROM transfers WHERE source_wallet_id = ?", walletId);
        return ((Number) row.get("cnt")).intValue();
    }

    /** Count COMPLETED transfers between two wallets with a specific idempotency key. */
    public int countCompletedByIdempotencyKey(String key) {
        Map<String, Object> row = db.queryOne(
                "SELECT COUNT(*) AS cnt FROM transfers WHERE idempotency_key = ? AND status = 'COMPLETED'",
                key);
        return ((Number) row.get("cnt")).intValue();
    }

    /** Return all transfer_events for a transfer. */
    public List<Map<String, Object>> findEventsByTransferId(String transferId) {
        return db.query("SELECT * FROM transfer_events WHERE transfer_id = ? ORDER BY id", transferId);
    }

    /** Return all outbox_events for a transfer. */
    public List<Map<String, Object>> findOutboxByTransferId(String transferId) {
        return db.query("SELECT * FROM outbox_events WHERE transfer_id = ? ORDER BY id", transferId);
    }

    /** Delete transfer + cascade for isolation teardown. */
    public void deleteByIdempotencyKey(String key) {
        List<Map<String, Object>> rows = findByIdempotencyKey(key);
        rows.forEach(r -> {
            String id = (String) r.get("id");
            db.execute("DELETE FROM transfer_events WHERE transfer_id = ?", id);
            db.execute("DELETE FROM outbox_events    WHERE transfer_id = ?", id);
        });
        db.execute("DELETE FROM transfers WHERE idempotency_key = ?", key);
    }
}

