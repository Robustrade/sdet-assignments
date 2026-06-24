package com.wallet.fixture;

import com.wallet.client.DatabaseVerificationClient;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Factory for creating test wallets in the database.
 *
 * Every created wallet is given a unique owner_id derived from a random UUID
 * so tests cannot accidentally share wallet state.
 */
public class WalletFixture {

    private final DatabaseVerificationClient dbClient;

    public WalletFixture(DatabaseVerificationClient dbClient) {
        this.dbClient = dbClient;
    }

    // ─── Pre-built wallet archetypes ──────────────────────────────────────────

    /** Standard funded USD wallet with $1,000.00 balance. */
    public String createFundedUsdWallet() {
        return createWallet("USD", new BigDecimal("1000.00"));
    }

    /** Wallet with exactly the amount needed for a single $100 transfer. */
    public String createExactBalanceWallet(BigDecimal exactBalance, String currency) {
        return createWallet(currency, exactBalance);
    }

    /** Wallet with zero balance — any debit attempt must fail. */
    public String createEmptyWallet(String currency) {
        return createWallet(currency, BigDecimal.ZERO);
    }

    /** Wallet with a high balance for concurrency tests that hammer it in parallel. */
    public String createHighBalanceWallet(String currency) {
        return createWallet(currency, new BigDecimal("1000000.00"));
    }

    /** Wallet in a non-USD currency. */
    public String createFundedWallet(String currency, BigDecimal balance) {
        return createWallet(currency, balance);
    }

    /** Two-sided pair: source with sufficient funds, empty destination. */
    public WalletPair createTransferPair(String currency, BigDecimal sourceBalance) {
        String sourceId = createWallet(currency, sourceBalance);
        String destId   = createWallet(currency, BigDecimal.ZERO);
        return new WalletPair(sourceId, destId);
    }

    /** Convenience: USD pair with $1,000 source balance. */
    public WalletPair createDefaultUsdPair() {
        return createTransferPair("USD", new BigDecimal("1000.00"));
    }

    // ─── Raw creation ─────────────────────────────────────────────────────────

    public String createWallet(String currency, BigDecimal balance) {
        String ownerId = "test-owner-" + UUID.randomUUID();
        return dbClient.createWallet(ownerId, currency, balance);
    }

    // ─── Inner types ─────────────────────────────────────────────────────────

    public record WalletPair(String sourceId, String destinationId) {}
}
