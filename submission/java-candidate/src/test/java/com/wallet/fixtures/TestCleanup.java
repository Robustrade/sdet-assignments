package com.wallet.fixtures;

import com.wallet.db.DbClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * Registers resources (wallet IDs, idempotency keys, transfer IDs) created during
 * a test and rolls them back after the test completes.
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
     * Deletes all tracked rows in dependency order.
     * Silently ignores rows that were already cleaned up.
     */
    public void rollback() {
        // 1. Events referencing transfers
        transferIds.forEach(id -> {
            silentDelete("DELETE FROM outbox_events    WHERE transfer_id = ?", id);
            silentDelete("DELETE FROM transfer_events  WHERE transfer_id = ?", id);
        });

        // 2. Transfer rows
        transferIds.forEach(id -> silentDelete("DELETE FROM transfers WHERE id = ?", id));

        // 3. Idempotency keys
        idempotencyKeys.forEach(k -> silentDelete("DELETE FROM idempotency_keys WHERE key = ?", k));

        // 4. Wallets created for this test (these are test-scoped, not canonical ones)
        walletIds.forEach(w -> silentDelete("DELETE FROM wallets WHERE id = ?", w));

        transferIds.clear();
        idempotencyKeys.clear();
        walletIds.clear();

        log.debug("TestCleanup: rollback complete");
    }

    private void silentDelete(String sql, Object param) {
        try {
            db.execute(sql, param);
        } catch (Exception e) {
            log.warn("Cleanup delete failed (non-fatal): {} [{}] — {}", sql, param, e.getMessage());
        }
    }
}
