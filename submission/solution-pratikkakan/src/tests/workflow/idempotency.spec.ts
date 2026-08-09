import { test, expect } from '../../fixtures';
import { buildTransferRequest, generateIdempotencyKey } from '../../helpers/builders';

/**
 * @reliability
 *
 * Idempotency is the most critical correctness property of a wallet service:
 * a client must be able to safely retry any request without double-spending.
 *
 * Each test is tagged @reliability so CI can run them independently:
 *   npm run test:reliability
 */

test.describe('@reliability Idempotency / Duplicate Submission', () => {
  test('first request with a new key creates the transfer and returns 201', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (0), key=${key.slice(0, 8)}...`);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 }),
      key,
    );

    expect(res.status()).toBe(201);

    const { id } = await res.json();
    expect(db.getIdempotencyRecord(key)?.transfer_id).toBe(id);
    console.log(`[assert] POST → ${res.status()}, idempotency record points to transfer_id=${id} ✓`);
  });

  test('duplicate request (same key + same payload) returns 200 with the original response body', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 });

    const first = await apiClient.createTransfer(payload, key);
    const firstBody = await first.json();
    console.log(`[setup] original request → ${first.status()}, id=${firstBody.id}`);

    const second = await apiClient.createTransfer(payload, key);

    expect(second.status()).toBe(200);
    const secondBody = await second.json();

    // The replay must return the exact same logical result
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.status).toBe('COMPLETED');
    console.log(`[assert] replay → ${second.status()}, same id=${secondBody.id}, status=${secondBody.status} ✓`);
  });

  test('duplicate does not create a second transfer row in the database', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 });
    console.log(`[setup] sending same request twice with key=${key.slice(0, 8)}...`);

    await apiClient.createTransfer(payload, key);
    await apiClient.createTransfer(payload, key);

    const rows = db.getTransfersByIdempotencyKey(key);
    expect(rows).toHaveLength(1);
    console.log(`[assert] DB transfer rows for key=${rows.length} (no duplicate created) ✓`);
  });

  test('duplicate does not double-debit the source wallet', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const amount = 2_000;
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount });
    console.log(`[setup] src=${sourceId} (10000), amount=${amount}, sending twice`);

    await apiClient.createTransfer(payload, key);
    await apiClient.createTransfer(payload, key);

    // Balance must reflect exactly ONE debit, not two
    const srcBalance = db.getWallet(sourceId).balance;
    expect(srcBalance).toBe(10_000 - amount);
    console.log(`[assert] src balance=${srcBalance} (debited once, expected ${10_000 - amount}) ✓`);
  });

  test('duplicate does not double-credit the destination wallet', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const amount = 2_000;
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount });
    console.log(`[setup] dst=${destId} (5000), amount=${amount}, sending twice`);

    await apiClient.createTransfer(payload, key);
    await apiClient.createTransfer(payload, key);

    const dstBalance = db.getWallet(destId).balance;
    expect(dstBalance).toBe(5_000 + amount);
    console.log(`[assert] dst balance=${dstBalance} (credited once, expected ${5_000 + amount}) ✓`);
  });

  test('idempotency_keys row references the correct transfer_id', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId }),
      key,
    );
    const { id } = await res.json();

    const record = db.getIdempotencyRecord(key);
    expect(record).toBeDefined();
    expect(record!.transfer_id).toBe(id);
    expect(record!.response_status).toBe(201);
    console.log(`[assert] idempotency_keys: transfer_id=${record!.transfer_id}, response_status=${record!.response_status} ✓`);
  });

  test('same key + different payload returns 409 IDEMPOTENCY_CONFLICT', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    console.log(`[setup] key=${key.slice(0, 8)}..., first request amount=1000, second request amount=9999`);

    // First: amount = 1_000
    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 }),
      key,
    );

    // Second: same key, different amount → conflict
    const conflict = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      key,
    );

    const body = await conflict.json();
    expect(conflict.status()).toBe(409);
    expect(body.error).toBe('IDEMPOTENCY_CONFLICT');
    console.log(`[assert] conflict → ${conflict.status()} ${body.error} ✓`);
  });

  test('conflict response does not mutate the original transfer or balances', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    console.log(`[setup] src=${sourceId} (10000), original amount=1000, conflict attempt amount=5000`);

    const firstRes = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 }),
      key,
    );
    const { id: originalId } = await firstRes.json();

    // Conflict attempt
    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
      key,
    );

    // Exactly one transfer row still exists
    expect(db.getTransfersByIdempotencyKey(key)).toHaveLength(1);
    // Balance reflects only the original debit
    expect(db.getWallet(sourceId).balance).toBe(10_000 - 1_000);
    // Original transfer record is unchanged
    expect(db.getTransfer(originalId).amount).toBe(1_000);
    console.log(`[assert] 1 transfer row, src balance=${db.getWallet(sourceId).balance}, original amount=1000 (unchanged) ✓`);
  });

  test('multiple unique keys create multiple independent transfer rows', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(30_000, 0);

    const keys = [generateIdempotencyKey(), generateIdempotencyKey(), generateIdempotencyKey()];
    console.log(`[setup] src=${sourceId} (30000), sending 3 transfers (1000 each) with unique keys`);

    await Promise.all(
      keys.map((k) =>
        apiClient.createTransfer(
          buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 }),
          k,
        ),
      ),
    );

    const count = db.countTransfersForWallet(sourceId);
    const srcBalance = db.getWallet(sourceId).balance;
    expect(count).toBe(3);
    expect(srcBalance).toBe(30_000 - 3_000);
    console.log(`[assert] transfer count=${count}, src balance=${srcBalance} (debited 3x1000) ✓`);
  });
});
