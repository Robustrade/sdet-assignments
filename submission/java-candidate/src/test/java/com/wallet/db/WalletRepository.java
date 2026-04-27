package com.wallet.db;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Repository for wallet table queries used in DB assertions.
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

    /** Return the current balance for the given wallet. Throws if wallet doesn't exist. */
    public BigDecimal getBalance(String walletId) {
        Map<String, Object> row = db.queryOne("SELECT balance FROM wallets WHERE id = ?", walletId);
        return (BigDecimal) row.get("balance");
    }

    /** Directly seed a wallet row (used by TestDataSeeder). */
    public void upsert(String id, String ownerName, BigDecimal balance, String currency) {
        db.execute("""
                INSERT INTO wallets (id, owner_name, balance, currency)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE
                  SET balance = EXCLUDED.balance,
                      owner_name = EXCLUDED.owner_name,
                      updated_at = NOW()
                """, id, ownerName, balance, currency);
    }

    /** Reset a wallet's balance directly (for test teardown). */
    public void resetBalance(String walletId, BigDecimal balance) {
        db.execute("UPDATE wallets SET balance = ?, updated_at = NOW() WHERE id = ?",
                balance, walletId);
    }

    /** Delete a wallet row. Cascades to transfers (FK). */
    public void delete(String walletId) {
        db.execute("DELETE FROM wallets WHERE id = ?", walletId);
    }
}

