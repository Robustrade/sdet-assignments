package com.kulu.sdet.repo;

import com.kulu.sdet.domain.TransferView;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class TransferRepo {
  private final JdbcTemplate jdbc;

  public TransferRepo(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static final RowMapper<TransferView> MAPPER =
      (rs, i) ->
          new TransferView(
              rs.getString("id"),
              rs.getString("source_wallet_id"),
              rs.getString("destination_wallet_id"),
              rs.getLong("amount"),
              rs.getString("currency"),
              rs.getString("reference"),
              rs.getString("status"),
              rs.getString("idempotency_key"),
              rs.getTimestamp("created_at").toInstant());

  private static final String SELECT =
      "SELECT id, source_wallet_id, destination_wallet_id, amount, currency,"
          + " reference, status, idempotency_key, created_at FROM transfers";

  public Optional<TransferView> findById(String id) {
    return jdbc.query(SELECT + " WHERE id = ?", MAPPER, id).stream().findFirst();
  }

  public List<TransferView> findByIdempotencyKey(String key) {
    return jdbc.query(SELECT + " WHERE idempotency_key = ?", MAPPER, key);
  }

  public int countByIdempotencyKey(String key) {
    Integer n =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM transfers WHERE idempotency_key = ?", Integer.class, key);
    return n == null ? 0 : n;
  }

  public void insert(TransferView t) {
    jdbc.update(
        "INSERT INTO transfers"
            + " (id, source_wallet_id, destination_wallet_id, amount, currency, reference,"
            + " status, idempotency_key, created_at)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        t.id(),
        t.sourceWalletId(),
        t.destinationWalletId(),
        t.amount(),
        t.currency(),
        t.reference(),
        t.status(),
        t.idempotencyKey(),
        Timestamp.from(t.createdAt()));
  }
}
