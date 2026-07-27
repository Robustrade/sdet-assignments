package com.kulu.sdet.repo;

import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Transactional outbox. The unique index on (aggregate_id, event_type) guarantees at most one row
 * per (transfer, event) — exactly-once at write time, even under concurrent duplicate submissions.
 */
@Repository
public class OutboxRepo {
  private final JdbcTemplate jdbc;

  public OutboxRepo(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public boolean enqueueIfAbsent(String aggregateId, String eventType, String payloadJson) {
    try {
      jdbc.update(
          "INSERT INTO outbox_events (aggregate_id, event_type, payload) VALUES (?, ?, ?)",
          aggregateId,
          eventType,
          payloadJson);
      return true;
    } catch (DuplicateKeyException dup) {
      return false;
    }
  }

  public int countByAggregate(String aggregateId) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ?",
            Integer.class,
            aggregateId);
    return n == null ? 0 : n;
  }

  public List<Map<String, Object>> findUnpublished(int limit) {
    return jdbc.queryForList(
        "SELECT id, aggregate_id, event_type, payload FROM outbox_events"
            + " WHERE published_at IS NULL ORDER BY id LIMIT ?",
        limit);
  }

  public void markPublished(long id) {
    jdbc.update("UPDATE outbox_events SET published_at = CURRENT_TIMESTAMP WHERE id = ?", id);
  }
}
