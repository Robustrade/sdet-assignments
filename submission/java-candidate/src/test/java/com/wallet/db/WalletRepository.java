package com.wallet.db;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Queries against the wallets table.
 * Used by tests to read balances and seed/clean up wallet data.
 */
public class WalletRepository {

    private final DbClient db;

    public WalletRepository(DbClient db) {
        this.db = db;
    }

    /** Find a wallet row by id; empty if not found. */
    public Optional<Map<String, Object>> findById(String walletId) {
        List<Map<String, Object>> rows =
                db.query("SELECT * FROM wallets WHERE id = ?", walletId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** Pulls the current balance — throws if the wallet doesn't exist. */
    public BigDecimal getBalance(String walletId) {
        Map<String, Object> row = db.queryOne("SELECT balance FROM wallets WHERE id = ?", walletId);
        return (BigDecimal) row.get("balance");
    }

    /** Creates or updates a wallet row — safe to call multiple times. */
    public void upsert(String id, String ownerName, BigDecimal balance, String currency) {
        // ON CONFLICT means we can call this repeatedly without worrying about duplicates
        db.execute("""
                INSERT INTO wallets (id, owner_name, balance, currency)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE
                  SET balance = EXCLUDED.balance,
                      owner_name = EXCLUDED.owner_name,
                      updated_at = NOW()
                """, id, ownerName, balance, currency);
    }

    /** Directly sets a wallet balance — used to restore state after a test. */
    public void resetBalance(String walletId, BigDecimal balance) {
        db.execute("UPDATE wallets SET balance = ?, updated_at = NOW() WHERE id = ?",
                balance, walletId);
    }

    /** Removes the wallet row. FK cascades will clean up transfers too. */
    public void delete(String walletId) {
        // cascade takes care of related transfer rows automatically
        db.execute("DELETE FROM wallets WHERE id = ?", walletId);
    }
}

