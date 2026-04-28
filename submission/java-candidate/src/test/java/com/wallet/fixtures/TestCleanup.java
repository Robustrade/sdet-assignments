package com.wallet.fixtures;

import com.wallet.db.DbClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * Tracks DB rows created during a test and deletes them afterward.
 * Because tests that create wallets or transfers need to clean up, otherwise they pile up
 * and start interfering with each other over time.
 *
 * Usage:
 * <pre>
 *   private TestCleanup cleanup;
 *
 *   \@BeforeEach void setUp() { cleanup = new TestCleanup(db); }
 *   \@AfterEach  void tearDown() { cleanup.rollback(); }
 *
 *   void test() {
 *       String walletId = walletBuilder.create();
 *       cleanup.trackWallet(walletId);
 *       ...
 *   }
 * </pre>
 */
public class TestCleanup {

    private static final Logger log = LoggerFactory.getLogger(TestCleanup.class);

    private final DbClient db;
    // track everything created during a test so we can clean it all up afterward
    private final List<String> transferIds   = new ArrayList<>();
    private final List<String> idempotencyKeys = new ArrayList<>();
    private final List<String> walletIds     = new ArrayList<>();

    public TestCleanup(DbClient db) {
        this.db = db;
    }

    public TestCleanup trackTransfer(String transferId) {
        transferIds.add(transferId);
        return this;
    }

    public TestCleanup trackIdempotencyKey(String key) {
        idempotencyKeys.add(key);
        return this;
    }

    public TestCleanup trackWallet(String walletId) {
        walletIds.add(walletId);
        return this;
    }

    /**
     * Deletes everything that was tracked, in the right order to avoid FK constraint errors.
     * Failures are swallowed — a row being gone already is fine.
     */
    public void rollback() {
        // 1. clear events before transfers (FK constraint)
        transferIds.forEach(id -> {
            silentDelete("DELETE FROM outbox_events    WHERE transfer_id = ?", id);
            silentDelete("DELETE FROM transfer_events  WHERE transfer_id = ?", id);
        });

        // 2. now safe to delete the transfer rows themselves
        transferIds.forEach(id -> silentDelete("DELETE FROM transfers WHERE id = ?", id));

        // 3. idempotency keys — these reference transfers so must come after
        idempotencyKeys.forEach(k -> silentDelete("DELETE FROM idempotency_keys WHERE key = ?", k));

        // 4. wallets created for this test (these are test-scoped, not canonical ones)
        walletIds.forEach(w -> silentDelete("DELETE FROM wallets WHERE id = ?", w));

        // clear the lists so re-running @BeforeEach starts fresh
        transferIds.clear();
        idempotencyKeys.clear();
        walletIds.clear();

        log.debug("TestCleanup: rollback complete");
    }

    private void silentDelete(String sql, Object param) {
        try {
            db.execute(sql, param);
        } catch (Exception e) {
            // not fatal — the row might have already been cleaned up another way
            log.warn("Cleanup delete failed (non-fatal): {} [{}] — {}", sql, param, e.getMessage());
        }
    }
}
