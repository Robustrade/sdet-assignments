package com.kulu.sdet.repo;

import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AuditRepo {
  private final JdbcTemplate jdbc;

  public AuditRepo(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public void append(String transferId, String eventType, String payloadJson) {
    jdbc.update(
        "INSERT INTO transfer_events (transfer_id, event_type, payload) VALUES (?, ?, ?)",
        transferId,
        eventType,
        payloadJson);
  }

  public List<Map<String, Object>> findByTransfer(String transferId) {
    return jdbc.queryForList(
        "SELECT id, transfer_id, event_type, payload, created_at FROM transfer_events"
            + " WHERE transfer_id = ? ORDER BY id",
        transferId);
  }

  public int countByTransferAndType(String transferId, String eventType) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM transfer_events WHERE transfer_id = ? AND event_type = ?",
            Integer.class,
            transferId,
            eventType);
    return n == null ? 0 : n;
  }
}
