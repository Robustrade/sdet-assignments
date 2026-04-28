package com.wallet.fixtures;

import com.wallet.db.DbClient;
import com.wallet.db.WalletRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigDecimal;

/**
 * Sets up the four standard wallets (Alice, Bob, Charlie, Empty) that most tests rely on.
 * Can be called in @BeforeEach safely since upsert won't duplicate anything.
 * Tests that mutate balances should call resetBalances() after themselves,
 * or just create their own wallets via WalletBuilder if they need isolation.
 */
public class TestDataSeeder {

    private static final Logger log = LoggerFactory.getLogger(TestDataSeeder.class);

    // well-known wallet IDs — used by name in all tests
    public static final String ALICE   = "wallet_alice";
    public static final String BOB     = "wallet_bob";
    public static final String CHARLIE = "wallet_charlie";
    public static final String EMPTY   = "wallet_empty";  // always starts at 0

    // canonical starting balances — reset before each test class
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
     * Inserts (or updates) the four canonical wallets.
     * Safe to call every @BeforeEach — idempotent.
     */
    public void seedWallets() {
        // upsert is safe to call multiple times — keeps things idempotent
        walletRepo.upsert(ALICE,   "Alice",   ALICE_BALANCE,   "AED");
        walletRepo.upsert(BOB,     "Bob",     BOB_BALANCE,     "AED");
        walletRepo.upsert(CHARLIE, "Charlie", CHARLIE_BALANCE, "AED");
        walletRepo.upsert(EMPTY,   "Empty",   EMPTY_BALANCE,   "AED");
        log.debug("Seeded canonical wallets");
    }

    /**
     * Puts wallet balances back to their starting values.
     * Doesn't touch transfer/event rows — call TestCleanup.rollback() for those.
     */
    public void resetBalances() {
        // puts everything back to starting values so each test has a predictable state
        walletRepo.resetBalance(ALICE,   ALICE_BALANCE);
        walletRepo.resetBalance(BOB,     BOB_BALANCE);
        walletRepo.resetBalance(CHARLIE, CHARLIE_BALANCE);
        walletRepo.resetBalance(EMPTY,   EMPTY_BALANCE);
        log.debug("Reset canonical wallet balances");
    }
}
