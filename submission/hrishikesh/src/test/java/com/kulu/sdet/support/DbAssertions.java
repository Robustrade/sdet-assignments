package com.kulu.sdet.support;

import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Reusable, intent-revealing database assertions. Every read hits the real DB so tests prove that
 * API-visible state matches persisted state.
 */
@Component
public class DbAssertions {

  private final JdbcTemplate jdbc;

  public DbAssertions(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public long balanceOf(String walletId) {
    Long b = jdbc.queryForObject("SELECT balance FROM wallets WHERE id = ?", Long.class, walletId);
    if (b == null) {
      throw new AssertionError("wallet not found: " + walletId);
    }
    return b;
  }

  public int transferCount() {
    Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM transfers", Integer.class);
    return n == null ? 0 : n;
  }

  public int transferCountForIdempotencyKey(String key) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM transfers WHERE idempotency_key = ?", Integer.class, key);
    return n == null ? 0 : n;
  }

  public Map<String, Object> transferRow(String transferId) {
    return jdbc.queryForMap("SELECT * FROM transfers WHERE id = ?", transferId);
  }

  public int idempotencyRowCount(String key) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM idempotency_keys WHERE idempotency_key = ?", Integer.class, key);
    return n == null ? 0 : n;
  }

  public Map<String, Object> idempotencyRow(String key) {
    return jdbc.queryForMap(
        "SELECT idempotency_key, payload_hash, transfer_id, response_status, response_body"
            + " FROM idempotency_keys WHERE idempotency_key = ?",
        key);
  }

  public int auditCount(String transferId, String eventType) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM transfer_events WHERE transfer_id = ? AND event_type = ?",
            Integer.class,
            transferId,
            eventType);
    return n == null ? 0 : n;
  }

  public List<Map<String, Object>> auditRows(String transferId) {
    return jdbc.queryForList(
        "SELECT id, transfer_id, event_type, payload, created_at FROM transfer_events"
            + " WHERE transfer_id = ? ORDER BY id",
        transferId);
  }

  public int outboxCount(String transferId) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ?", Integer.class, transferId);
    return n == null ? 0 : n;
  }

  public int outboxCount(String transferId, String eventType) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ? AND event_type = ?",
            Integer.class,
            transferId,
            eventType);
    return n == null ? 0 : n;
  }

  public List<Map<String, Object>> outboxRows(String transferId) {
    return jdbc.queryForList(
        "SELECT id, aggregate_id, event_type, payload, published_at FROM outbox_events"
            + " WHERE aggregate_id = ? ORDER BY id",
        transferId);
  }
}
