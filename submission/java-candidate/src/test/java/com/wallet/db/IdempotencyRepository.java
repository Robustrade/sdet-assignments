package com.wallet.db;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Queries against the idempotency_keys table.
 * Tests use this to verify the key was stored and has the right status after a transfer.
 */
public class IdempotencyRepository {

    private final DbClient db;

    public IdempotencyRepository(DbClient db) {
        this.db = db;
    }

    public Optional<Map<String, Object>> findByKey(String key) {
        List<Map<String, Object>> rows =
                db.query("SELECT * FROM idempotency_keys WHERE key = ?", key);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    // simple presence check — don't need the full row most of the time
    public boolean exists(String key) {
        return findByKey(key).isPresent();
    }

    /** Gets the stored request hash for a key — lets us verify the service hashed it correctly. */
    public String getRequestHash(String key) {
        return (String) db.queryOne(
                "SELECT request_hash FROM idempotency_keys WHERE key = ?", key)
                .get("request_hash");
    }

    public String getStatus(String key) {
        return (String) db.queryOne(
                "SELECT status FROM idempotency_keys WHERE key = ?", key)
                .get("status");
    }

    // called during cleanup — delete the key so it doesn't affect other tests
    public void delete(String key) {
        db.execute("DELETE FROM idempotency_keys WHERE key = ?", key);
    }
}

