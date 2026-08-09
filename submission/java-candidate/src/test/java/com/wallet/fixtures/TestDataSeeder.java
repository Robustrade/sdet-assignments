package com.wallet.fixtures;

import com.wallet.db.DbClient;
import com.wallet.db.WalletRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigDecimal;

/**
 * Seeds the database with the known wallet fixtures used across the test suite.
 *
 * All wallets are idempotently upserted — safe to call in @BeforeEach.
 * Each test that mutates balances should record the pre-test balance and restore it
 * via TestCleanup, or use wallet ids that are test-scoped (created dynamically via WalletBuilder).
 */
public class TestDataSeeder {

    private static final Logger log = LoggerFactory.getLogger(TestDataSeeder.class);

    // Well-known wallet IDs that all tests may reference
    public static final String ALICE   = "wallet_alice";
    public static final String BOB     = "wallet_bob";
    public static final String CHARLIE = "wallet_charlie";
    public static final String EMPTY   = "wallet_empty";

    // Canonical starting balances (reset before each test class)
    public static final BigDecimal ALICE_BALANCE   = BigDecimal.valueOf(10_000);
    public static final BigDecimal BOB_BALANCE     = BigDecimal.valueOf(5_000);
    public static final BigDecimal CHARLIE_BALANCE = BigDecimal.valueOf(1_000);
    public static final BigDecimal EMPTY_BALANCE   = BigDecimal.ZERO;

    private final WalletRepository walletRepo;
    private final DbClient         db;

    public TestDataSeeder(DbClient db) {
        this.db         = db;
        this.walletRepo = new WalletRepository(db);
    }

    /**
     * Seeds the four canonical wallets with their default balances.
     * Call this in @BeforeEach / @BeforeAll to get a clean slate.
     */
    public void seedWallets() {
        walletRepo.upsert(ALICE,   "Alice",   ALICE_BALANCE,   "AED");
        walletRepo.upsert(BOB,     "Bob",     BOB_BALANCE,     "AED");
        walletRepo.upsert(CHARLIE, "Charlie", CHARLIE_BALANCE, "AED");
        walletRepo.upsert(EMPTY,   "Empty",   EMPTY_BALANCE,   "AED");
        log.debug("Seeded canonical wallets");
    }

    /**
     * Resets canonical wallet balances back to defaults.
     * Does NOT delete transfer/event rows — use TestCleanup for that.
     */
    public void resetBalances() {
        walletRepo.resetBalance(ALICE,   ALICE_BALANCE);
        walletRepo.resetBalance(BOB,     BOB_BALANCE);
        walletRepo.resetBalance(CHARLIE, CHARLIE_BALANCE);
        walletRepo.resetBalance(EMPTY,   EMPTY_BALANCE);
        log.debug("Reset canonical wallet balances");
    }
}
