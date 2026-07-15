package com.kulu.sdet.repo;

import com.kulu.sdet.domain.WalletView;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class WalletRepo {
  private final JdbcTemplate jdbc;

  public WalletRepo(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static final RowMapper<WalletView> MAPPER =
      (rs, i) ->
          new WalletView(rs.getString("id"), rs.getLong("balance"), rs.getString("currency"));

  public Optional<WalletView> findById(String id) {
    return jdbc.query("SELECT id, balance, currency FROM wallets WHERE id = ?", MAPPER, id).stream()
        .findFirst();
  }

  /** Row-locked read; must be called inside a transaction. */
  public Optional<WalletView> lockById(String id) {
    return jdbc
        .query("SELECT id, balance, currency FROM wallets WHERE id = ? FOR UPDATE", MAPPER, id)
        .stream()
        .findFirst();
  }

  public void debit(String id, long amount) {
    int rows =
        jdbc.update(
            "UPDATE wallets SET balance = balance - ? WHERE id = ? AND balance >= ?",
            amount,
            id,
            amount);
    if (rows != 1) {
      throw new IllegalStateException("debit failed for wallet " + id);
    }
  }

  public void credit(String id, long amount) {
    int rows = jdbc.update("UPDATE wallets SET balance = balance + ? WHERE id = ?", amount, id);
    if (rows != 1) {
      throw new IllegalStateException("credit failed for wallet " + id);
    }
  }
}
