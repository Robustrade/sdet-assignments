// tests/concurrency/concurrency.spec.js
/**
 * Concurrency Tests
 * These fire multiple requests in parallel using Promise.all to surface
 * race conditions around:
 *  - competing transfers draining a shared balance
 *  - duplicate in-flight requests with the same idempotency key
 *  - exactly-once semantics under parallel retries
 */
const { expect } = require('@playwright/test');
const { test }   = require('../../fixtures/wallet-fixture');
const {
  createTransfer, getWallet,
  dbTransfers, dbIdempotencyKeys, dbOutboxEvents,
} = require('../../utils/api-client');
const { buildTransferPayload, newIdempotencyKey, walletId } = require('../../utils/data-builders');
const { createWallet } = require('../../utils/api-client');

test.describe('Concurrency & Race Conditions', () => {

  test('concurrent duplicate requests with same idempotency key: exactly one transfer created', async ({ request, wallets }) => {
    const key = newIdempotencyKey();
    const payload = buildTransferPayload({
      source_wallet_id: wallets.src,
      destination_wallet_id: wallets.dst,
      amount: 1000,
    });

    // Fire 5 identical requests simultaneously
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => createTransfer(request, payload, key))
    );

    const statuses = responses.map(r => r.status());
    // At least one 201, the rest 200 (replays)
    expect(statuses).toContain(201);
    expect(statuses.every(s => s === 200 || s === 201)).toBe(true);

    // All responses return the same transfer id
    const bodies = await Promise.all(responses.map(r => r.json()));
    const ids = new Set(bodies.map(b => b.id));
    expect(ids.size).toBe(1);

    // Only one DB row
    const transfers = await dbTransfers(request);
    expect(transfers.filter(t => t.idempotency_key === key)).toHaveLength(1);

    // Balance moved exactly once
    const src = await (await getWallet(request, wallets.src)).json();
    expect(src.balance).toBe(10000 - 1000);

    // One outbox event
    const outbox = await dbOutboxEvents(request);
    const tid    = [...ids][0];
    expect(outbox.filter(e => e.transfer_id === tid)).toHaveLength(1);
  });

  test('competing transfers: total debits never exceed available balance', async ({ request, wallets }) => {
    // Wallet has 10000. Fire 6 concurrent transfers of 2000 each (total 12000).
    // At most 5 should succeed; wallet balance should never go negative.
    const AMOUNT = 2000;
    const CONCURRENT = 6;

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        createTransfer(request, buildTransferPayload({
          source_wallet_id: wallets.src,
          destination_wallet_id: wallets.dst,
          amount: AMOUNT,
        }), newIdempotencyKey())
      )
    );

    const statuses = responses.map(r => r.status());
    const successes = statuses.filter(s => s === 201).length;
    const failures  = statuses.filter(s => s === 422).length;

    expect(successes + failures).toBe(CONCURRENT);
    // At most floor(10000/2000) = 5 can succeed
    expect(successes).toBeLessThanOrEqual(5);

    const src = await (await getWallet(request, wallets.src)).json();
    // Balance must never be negative
    expect(src.balance).toBeGreaterThanOrEqual(0);
    // Balance must equal exactly: 10000 - (successes * AMOUNT)
    expect(src.balance).toBe(10000 - successes * AMOUNT);
  });

  test('concurrent transfers with unique keys: each executes independently', async ({ request, wallets }) => {
    // Small amounts so all succeed
    const AMOUNT = 500;
    const N = 5;

    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        createTransfer(request, buildTransferPayload({
          source_wallet_id: wallets.src,
          destination_wallet_id: wallets.dst,
          amount: AMOUNT,
        }), newIdempotencyKey())
      )
    );

    const statuses = responses.map(r => r.status());
    expect(statuses.every(s => s === 201)).toBe(true);

    const transfers = await dbTransfers(request);
    expect(transfers).toHaveLength(N);

    // All transfer IDs are unique
    const ids = transfers.map(t => t.id);
    expect(new Set(ids).size).toBe(N);

    const src = await (await getWallet(request, wallets.src)).json();
    expect(src.balance).toBe(10000 - N * AMOUNT);
  });

  test('concurrent transfers from two different sources: no cross-wallet contamination', async ({ request }) => {
    // Two isolated source wallets → one shared destination
    const src1 = walletId('s1');
    const src2 = walletId('s2');
    const dst  = walletId('d');

    await createWallet(request, src1, 5000, 'AED');
    await createWallet(request, src2, 5000, 'AED');
    await createWallet(request, dst,  0,    'AED');

    const [r1, r2] = await Promise.all([
      createTransfer(request, buildTransferPayload({
        source_wallet_id: src1, destination_wallet_id: dst, amount: 3000,
      }), newIdempotencyKey()),
      createTransfer(request, buildTransferPayload({
        source_wallet_id: src2, destination_wallet_id: dst, amount: 4000,
      }), newIdempotencyKey()),
    ]);

    expect(r1.status()).toBe(201);
    expect(r2.status()).toBe(201);

    const w1 = await (await getWallet(request, src1)).json();
    const w2 = await (await getWallet(request, src2)).json();
    const wd = await (await getWallet(request, dst)).json();

    expect(w1.balance).toBe(2000);
    expect(w2.balance).toBe(1000);
    expect(wd.balance).toBe(7000); // 3000 + 4000
  });

  test('read-after-write: GET after concurrent transfers reflects final state', async ({ request, wallets }) => {
    const N = 4;
    const AMOUNT = 500;

    await Promise.all(
      Array.from({ length: N }, () =>
        createTransfer(request, buildTransferPayload({
          source_wallet_id: wallets.src,
          destination_wallet_id: wallets.dst,
          amount: AMOUNT,
        }), newIdempotencyKey())
      )
    );

    // After all writes, read must reflect net movement
    const src = await (await getWallet(request, wallets.src)).json();
    const dst = await (await getWallet(request, wallets.dst)).json();
    expect(src.balance).toBe(10000 - N * AMOUNT);
    expect(dst.balance).toBe(5000 + N * AMOUNT);
    // Conservation
    expect(src.balance + dst.balance).toBe(15000);
  });

});
