import { test, expect } from '../../fixtures';
import { buildTransferRequest, generateIdempotencyKey } from '../../helpers/builders';

/**
 * @reliability
 *
 * Concurrency tests fire multiple requests simultaneously via Promise.all().
 * Node.js is single-threaded and better-sqlite3 serialises writes, so these
 * are rapid-succession tests rather than true OS-level concurrent writes.
 * They are still valuable: they catch double-debit bugs that a naive
 * non-transactional implementation would exhibit.
 *
 * Documented limitation: SQLite write-locks at DB level, not row level.
 * Production Postgres would use SELECT FOR UPDATE for true row-level locking.
 */

test.describe('@reliability Concurrency / Race Conditions', () => {
  test('two concurrent transfers within available balance both succeed', async ({ apiClient, db }) => {
    // Seed enough balance for both transfers
    const { sourceId, destId } = db.seedTestWallets(20_000, 0);
    console.log(`[setup] src=${sourceId} (20000), firing 2 concurrent transfers of 5000 each`);

    const [res1, res2] = await Promise.all([
      apiClient.createTransfer(
        buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
        generateIdempotencyKey(),
      ),
      apiClient.createTransfer(
        buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
        generateIdempotencyKey(),
      ),
    ]);

    expect(res1.status()).toBe(201);
    expect(res2.status()).toBe(201);

    // DB: exactly 2 transfer rows, full debit applied
    const count = db.countTransfersForWallet(sourceId);
    const srcBalance = db.getWallet(sourceId).balance;
    expect(count).toBe(2);
    expect(srcBalance).toBe(20_000 - 10_000);
    console.log(`[assert] both → 201, transfer count=${count}, src balance=${srcBalance} ✓`);
  });

  test('two concurrent transfers exceeding total balance: exactly one succeeds', async ({ apiClient, db }) => {
    // Source only has 6_000 — each transfer needs 5_000 so only one can succeed
    const { sourceId, destId } = db.seedTestWallets(6_000, 0);
    console.log(`[setup] src=${sourceId} (6000), 2 concurrent transfers of 5000 — only one can fit`);

    const [res1, res2] = await Promise.all([
      apiClient.createTransfer(
        buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
        generateIdempotencyKey(),
      ),
      apiClient.createTransfer(
        buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
        generateIdempotencyKey(),
      ),
    ]);

    const statuses = [res1.status(), res2.status()].sort();
    console.log(`[result] statuses=[${statuses.join(', ')}] — expect [201, 422]`);

    // One 201, one 422 — order is non-deterministic
    expect(statuses).toEqual([201, 422]);

    // Balance must reflect exactly one successful debit (no double-spend)
    const srcBalance = db.getWallet(sourceId).balance;
    expect(srcBalance).toBe(6_000 - 5_000);

    // Only one transfer row created
    const count = db.countTransfersForWallet(sourceId);
    expect(count).toBe(1);
    console.log(`[assert] src balance=${srcBalance}, transfer count=${count} (no double-spend) ✓`);
  });

  test('concurrent duplicate requests (same idempotency key) create only one transfer row', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(20_000, 0);
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 3_000 });
    console.log(`[setup] src=${sourceId} (20000), firing same request concurrently with key=${key.slice(0, 8)}...`);

    // Fire the same request concurrently — only one should create a transfer
    const [res1, res2] = await Promise.all([
      apiClient.createTransfer(payload, key),
      apiClient.createTransfer(payload, key),
    ]);

    const statuses = [res1.status(), res2.status()].sort();
    console.log(`[result] statuses=[${statuses.join(', ')}] — expect 200 or 201 (one original, one replay)`);
    // Both must be either 201 + 200 (one created, one replayed) or both 201 (race tie)
    for (const s of statuses) {
      expect([200, 201]).toContain(s);
    }

    // Regardless of race outcome: exactly one transfer row
    const rows = db.getTransfersByIdempotencyKey(key);
    expect(rows).toHaveLength(1);

    // Balance debited exactly once
    const srcBalance = db.getWallet(sourceId).balance;
    expect(srcBalance).toBe(20_000 - 3_000);
    console.log(`[assert] DB rows=${rows.length}, src balance=${srcBalance} (debited once) ✓`);
  });

  test('balance after multiple concurrent transfers is internally consistent', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(50_000, 0);
    const amount = 3_000;
    const requests = 10;
    console.log(`[setup] src=${sourceId} (50000), firing ${requests} concurrent transfers of ${amount}`);

    const responses = await Promise.all(
      Array.from({ length: requests }, () =>
        apiClient.createTransfer(
          buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
          generateIdempotencyKey(),
        ),
      ),
    );

    const successCount = responses.filter((r) => r.status() === 201).length;

    const sourceBalance = db.getWallet(sourceId).balance;
    const destBalance = db.getWallet(destId).balance;

    // DB balance = initial − (number of successes × amount)
    expect(sourceBalance).toBe(50_000 - successCount * amount);

    // Net conservation: money moved from source to dest exactly
    expect(destBalance).toBe(successCount * amount);

    // No money created or destroyed
    expect(sourceBalance + destBalance).toBe(50_000);
    console.log(`[assert] ${successCount}/${requests} succeeded, src=${sourceBalance}, dst=${destBalance}, total=${sourceBalance + destBalance} (conserved) ✓`);
  });

  test('concurrent transfers from different sources to same destination do not corrupt balances', async ({
    apiClient,
    db,
  }) => {
    // Two independent sources each send 2_000 to the same destination
    const { sourceId: src1, destId } = db.seedTestWallets(5_000, 0);
    const src2 = `w_src2_${Date.now()}`;
    db.seedWallet(src2, 5_000, 'AED');
    console.log(`[setup] src1=${src1} (5000), src2=${src2} (5000), dst=${destId} (0), each sending 2000 concurrently`);

    const [res1, res2] = await Promise.all([
      apiClient.createTransfer(
        buildTransferRequest({ source_wallet_id: src1, destination_wallet_id: destId, amount: 2_000 }),
        generateIdempotencyKey(),
      ),
      apiClient.createTransfer(
        buildTransferRequest({ source_wallet_id: src2, destination_wallet_id: destId, amount: 2_000 }),
        generateIdempotencyKey(),
      ),
    ]);

    expect(res1.status()).toBe(201);
    expect(res2.status()).toBe(201);

    expect(db.getWallet(src1).balance).toBe(3_000);
    expect(db.getWallet(src2).balance).toBe(3_000);
    expect(db.getWallet(destId).balance).toBe(4_000);
    console.log(`[assert] src1=3000, src2=3000, dst=4000 (both debits applied, no corruption) ✓`);
  });
});
