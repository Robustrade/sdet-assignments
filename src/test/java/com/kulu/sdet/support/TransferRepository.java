package com.kulu.sdet.support;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public class TransferRepository {


    private static final String RECENT_WINDOW = "5 minutes";

    private final DbClient db;

    public TransferRepository(DbClient db) {
        this.db = db;
    }


    public Optional<Map<String, Object>> findById(String transactionId) throws Exception {
        List<Map<String, Object>> rows = db.query("SELECT * FROM transactions WHERE id = ?", transactionId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }


    public long countCompleted() throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM transactions WHERE status = 'COMPLETED' " + "AND created_at > NOW() - INTERVAL '" + RECENT_WINDOW + "'");
    }


    public long countByStatus(String status) throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM transactions WHERE status = ? " + "AND created_at > NOW() - INTERVAL '" + RECENT_WINDOW + "'", status.toUpperCase());
    }


    public long countAll() throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM transactions " + "WHERE created_at > NOW() - INTERVAL '" + RECENT_WINDOW + "'");
    }


    public long countRowsForTransactionId(String transactionId) throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM transactions WHERE id = ?", transactionId);
    }


    public long countIdempotencyKeys() throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM idempotency_keys " + "WHERE created_at > NOW() - INTERVAL '" + RECENT_WINDOW + "'");
    }


    public long countIdempotencyKeysFor(String key) throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM idempotency_keys WHERE key = ?", key);
    }


    public long countAuditEventsFor(String transactionId) throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM audit_events " + "WHERE resource_type = 'TRANSFER' AND resource_id = ?", transactionId);
    }


    public List<Map<String, Object>> findAuditEventsFor(String transactionId) throws Exception {
        return db.query("SELECT * FROM audit_events " + "WHERE resource_type = 'TRANSFER' AND resource_id = ? " + "ORDER BY occurred_at", transactionId);
    }


    public long countAuditEventsRecent() throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM audit_events " + "WHERE resource_type = 'TRANSFER' " + "AND occurred_at > NOW() - INTERVAL '" + RECENT_WINDOW + "'");
    }


    public long countOutboxEventsFor(String transactionId) throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ?", transactionId);
    }


    public long countOutboxEventsRecent() throws Exception {
        return db.queryScalar("SELECT COUNT(*) FROM outbox_events " + "WHERE created_at > NOW() - INTERVAL '" + RECENT_WINDOW + "'");
    }


    public Optional<Map<String, Object>> outboxEventFor(String transactionId) throws Exception {
        List<Map<String, Object>> rows = db.query("SELECT * FROM outbox_events WHERE aggregate_id = ?", transactionId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }


    public boolean isAwaitingRelay(String transactionId) throws Exception {
        return outboxEventFor(transactionId).map(row -> row.get("published_at") == null).orElse(false);
    }
}
