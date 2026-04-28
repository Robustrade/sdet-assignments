package com.wallet.db;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Repository for idempotency_keys table queries used in DB assertions.
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

    public boolean exists(String key) {
        return findByKey(key).isPresent();
    }

    /** Verify stored hash matches the expected one. */
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

    public void delete(String key) {
        db.execute("DELETE FROM idempotency_keys WHERE key = ?", key);
    }
}

