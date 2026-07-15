package com.kulu.sdet.repo;

import java.util.Optional;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * Store of previously seen idempotency keys and their persisted responses.
 *
 * <p>A record here means: "we saw this key before, this was our answer, replay it verbatim on any
 * subsequent request that hashes to the same payload."
 */
@Repository
public class IdempotencyRepo {
  private final JdbcTemplate jdbc;

  public IdempotencyRepo(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public record Record(
      String idempotencyKey,
      String payloadHash,
      String transferId,
      int responseStatus,
      String responseBody) {}

  private static final RowMapper<Record> MAPPER =
      (rs, i) ->
          new Record(
              rs.getString("idempotency_key"),
              rs.getString("payload_hash"),
              rs.getString("transfer_id"),
              rs.getInt("response_status"),
              rs.getString("response_body"));

  public Optional<Record> find(String key) {
    return jdbc
        .query(
            "SELECT idempotency_key, payload_hash, transfer_id, response_status, response_body"
                + " FROM idempotency_keys WHERE idempotency_key = ?",
            MAPPER,
            key)
        .stream()
        .findFirst();
  }

  /**
   * Insert a new idempotency record. Returns false if the key already existed (a concurrent request
   * won the race).
   */
  public boolean insertIfAbsent(Record r) {
    try {
      jdbc.update(
          "INSERT INTO idempotency_keys"
              + " (idempotency_key, payload_hash, transfer_id, response_status, response_body)"
              + " VALUES (?, ?, ?, ?, ?)",
          r.idempotencyKey(),
          r.payloadHash(),
          r.transferId(),
          r.responseStatus(),
          r.responseBody());
      return true;
    } catch (DuplicateKeyException dup) {
      return false;
    }
  }

  /**
   * Claim an idempotency key by inserting a placeholder row. Throws {@link DuplicateKeyException}
   * if the key is already claimed. Must run inside the caller's transaction so that concurrent
   * losers block on the unique-index insert until the winner commits or rolls back.
   */
  public void insertPlaceholder(String key, String payloadHash) {
    jdbc.update(
        "INSERT INTO idempotency_keys"
            + " (idempotency_key, payload_hash, transfer_id, response_status, response_body)"
            + " VALUES (?, ?, NULL, 0, '')",
        key,
        payloadHash);
  }

  /** Fill in the placeholder row with the final persisted response. */
  public void updateResult(String key, String transferId, int responseStatus, String responseBody) {
    int rows =
        jdbc.update(
            "UPDATE idempotency_keys SET transfer_id = ?, response_status = ?, response_body = ?"
                + " WHERE idempotency_key = ?",
            transferId,
            responseStatus,
            responseBody,
            key);
    if (rows != 1) {
      throw new IllegalStateException("idempotency row missing for update: " + key);
    }
  }

  public int count(String key) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM idempotency_keys WHERE idempotency_key = ?", Integer.class, key);
    return n == null ? 0 : n;
  }
}
