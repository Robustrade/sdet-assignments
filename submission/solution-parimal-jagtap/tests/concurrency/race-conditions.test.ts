import { test, expect } from '../../fixtures/base';
import { validTransfer, idempotencyKey } from '../../helpers/test-data-factory';

/**
 * Concurrency & Reliability Tests
 *
 * These are the hardest scenarios to get right in
 * a wallet transfer system. Double-charges, race conditions,
 * and retry safety under concurrent load.
 */

test.describe('Concurrency — Race Conditions & Retry Safety', () => {

  test('concurrent duplicate requests with same idempotency key — only one transfer created', async ({ api, db }) => {
    const key = idempotencyKey();
    const payload = validTransfer({ amount: 100 });

    const balanceBefore = await db.getWalletBalance('wallet_001');

    // Fire 5 identical requests simultaneously
    const results = await Promise.all([
      api.createTransfer(payload, key),
      api.createTransfer(payload, key),
      api.createTransfer(payload, key),
      api.createTransfer(payload, key),
      api.createTransfer(payload, key),
    ]);

    const statuses = results.map(r => r.status());
    const bodies = await Promise.all(results.map(r => r.json()));

    // All must succeed (201 first, 200 for replays)
    statuses.forEach(s => expect([200, 201]).toContain(s));

    // All must return the same transfer_id
    const transferIds = new Set(bodies.map((b: any) => b.transfer_id));
    expect(transferIds.size).toBe(1);

    // Wallet debited exactly once
    const balanceAfter = await db.getWalletBalance('wallet_001');
    expect(balanceBefore - balanceAfter).toBe(100);
  });

  test('concurrent transfers competing for limited balance — no overdraft', async ({ api, db }) => {
    // wallet_003 has 0 balance — all concurrent attempts should fail
    const attempts = await Promise.all([
      api.createTransfer(validTransfer({ source_wallet_id: 'wallet_003', amount: 100 })),
      api.createTransfer(validTransfer({ source_wallet_id: 'wallet_003', amount: 100 })),
      api.createTransfer(validTransfer({ source_wallet_id: 'wallet_003', amount: 100 })),
    ]);

    const statuses = attempts.map(r => r.status());
    statuses.forEach(s => expect(s).toBe(422));

    // Balance must still be 0 — no overdraft
    const balance = await db.getWalletBalance('wallet_003');
    expect(balance).toBe(0);
  });

  test('concurrent transfers from wallet_001 — total debits must not exceed available balance', async ({ api, db }) => {
    const balanceBefore = await db.getWalletBalance('wallet_001');

    // Fire many concurrent transfers — some will succeed, some will fail
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.createTransfer(validTransfer({ amount: 1500 }))
      )
    );

    const statuses = attempts.map(r => r.status());
    const succeeded = statuses.filter(s => s === 201).length;
    const failed    = statuses.filter(s => s === 422).length;

    expect(succeeded + failed).toBe(10);

    // Balance after must not be negative
    const balanceAfter = await db.getWalletBalance('wallet_001');
    expect(balanceAfter).toBeGreaterThanOrEqual(0);

    // Total debited must match successful transfers only
    expect(balanceBefore - balanceAfter).toBe(succeeded * 1500);
  });

  test('retry after assumed response loss — idempotency prevents double debit', async ({ api, db }) => {
    const key = idempotencyKey();
    const payload = validTransfer({ amount: 200 });

    const balanceBefore = await db.getWalletBalance('wallet_001');

    // Simulate: first request succeeds
    const res1 = await api.createTransfer(payload, key);
    expect(res1.status()).toBe(201);

    // Simulate: client retries because it "didn't receive" the response
    const res2 = await api.createTransfer(payload, key);
    expect(res2.status()).toBe(200);

    // Simulate: client retries again
    const res3 = await api.createTransfer(payload, key);
    expect(res3.status()).toBe(200);

    // Only one debit despite 3 requests
    const balanceAfter = await db.getWalletBalance('wallet_001');
    expect(balanceBefore - balanceAfter).toBe(200);

    // All responses reference same transfer
    const bodies = await Promise.all([res1.json(), res2.json(), res3.json()]);
    const ids = new Set(bodies.map((b: any) => b.transfer_id));
    expect(ids.size).toBe(1);
  });

  test('concurrent requests without idempotency key — treated as separate transfers', async ({ api, db }) => {
    // No idempotency key — system cannot deduplicate
    const balanceBefore = await db.getWalletBalance('wallet_001');

    const results = await Promise.all([
      api.createTransfer(validTransfer({ amount: 50 })),
      api.createTransfer(validTransfer({ amount: 50 })),
      api.createTransfer(validTransfer({ amount: 50 })),
    ]);

    const succeeded = results.filter(r => r.status() === 201).length;
    const balanceAfter = await db.getWalletBalance('wallet_001');

    // Each successful transfer is a separate debit
    expect(balanceBefore - balanceAfter).toBe(succeeded * 50);
  });

});
