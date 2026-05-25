// tests/e2e/e2e-flow.spec.js
const { expect } = require('@playwright/test');
const { test }   = require('../../fixtures/wallet-fixture');
const {
  createTransfer, getTransfer, getWallet,
  dbTransfers, dbIdempotencyKeys, dbOutboxEvents,
} = require('../../utils/api-client');
const { buildTransferPayload, newIdempotencyKey } = require('../../utils/data-builders');

test.describe('End-to-End Transfer Flow', () => {

  test('full happy path: API → DB → wallets → events all consistent', async ({ request, wallets }) => {
    const AMOUNT = 2000;
    const key = newIdempotencyKey();
    const payload = buildTransferPayload({
      source_wallet_id: wallets.src,
      destination_wallet_id: wallets.dst,
      amount: AMOUNT,
      reference: 'e2e-invoice-001',
    });

    // 1. POST transfer
    const createRes = await createTransfer(request, payload, key);
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();

    // 2. GET transfer — must match create response
    const getRes  = await getTransfer(request, created.id);
    const fetched = await getRes.json();
    expect(fetched.id).toBe(created.id);
    expect(fetched.status).toBe('COMPLETED');
    expect(fetched.amount).toBe(AMOUNT);

    // 3. GET wallets — balances must reflect transfer
    const srcWallet = await (await getWallet(request, wallets.src)).json();
    const dstWallet = await (await getWallet(request, wallets.dst)).json();
    expect(srcWallet.balance).toBe(10000 - AMOUNT);
    expect(dstWallet.balance).toBe(5000 + AMOUNT);

    // 4. DB — transfer row matches API response
    const dbTx = await dbTransfers(request);
    const dbRow = dbTx.find(t => t.id === created.id);
    expect(dbRow).toBeTruthy();
    expect(dbRow.status).toBe('COMPLETED');
    expect(dbRow.idempotency_key).toBe(key);

    // 5. Outbox written
    const outbox = await dbOutboxEvents(request);
    expect(outbox.some(e => e.transfer_id === created.id)).toBe(true);
  });

  test('sequential transfers: balances compound correctly', async ({ request, wallets }) => {
    for (let i = 0; i < 3; i++) {
      const res = await createTransfer(request, buildTransferPayload({
        source_wallet_id: wallets.src,
        destination_wallet_id: wallets.dst,
        amount: 1000,
      }), newIdempotencyKey());
      expect(res.status()).toBe(201);
    }

    const src = await (await getWallet(request, wallets.src)).json();
    const dst = await (await getWallet(request, wallets.dst)).json();

    expect(src.balance).toBe(10000 - 3000);
    expect(dst.balance).toBe(5000 + 3000);

    const transfers = await dbTransfers(request);
    expect(transfers).toHaveLength(3);
  });

});

test.describe('Idempotency Semantics', () => {

  test('same key + same payload: returns original result, no double debit', async ({ request, wallets }) => {
    const key = newIdempotencyKey();
    const payload = buildTransferPayload({
      source_wallet_id: wallets.src,
      destination_wallet_id: wallets.dst,
      amount: 1000,
    });

    const res1 = await createTransfer(request, payload, key);
    const res2 = await createTransfer(request, payload, key); // replay
    const res3 = await createTransfer(request, payload, key); // replay again

    expect(res1.status()).toBe(201);
    expect(res2.status()).toBe(200);
    expect(res3.status()).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    const body3 = await res3.json();

    // Same logical transfer returned
    expect(body2.id).toBe(body1.id);
    expect(body3.id).toBe(body1.id);

    // Wallets moved only once
    const src = await (await getWallet(request, wallets.src)).json();
    const dst = await (await getWallet(request, wallets.dst)).json();
    expect(src.balance).toBe(10000 - 1000);
    expect(dst.balance).toBe(5000 + 1000);

    // Only one transfer row
    const transfers = await dbTransfers(request);
    expect(transfers.filter(t => t.idempotency_key === key)).toHaveLength(1);

    // Only one idempotency key row
    const keys = await dbIdempotencyKeys(request);
    expect(keys.filter(k => k.key === key)).toHaveLength(1);

    // Only one outbox event
    const outbox = await dbOutboxEvents(request);
    expect(outbox.filter(e => e.transfer_id === body1.id)).toHaveLength(1);
  });

  test('same key + different payload: 409, original transfer intact, balance unchanged', async ({ request, wallets }) => {
    const key = newIdempotencyKey();

    const res1 = await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: 500,
    }), key);
    expect(res1.status()).toBe(201);

    const res2 = await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: 9999,
    }), key);
    expect(res2.status()).toBe(409);

    // Balance moved only for original amount
    const src = await (await getWallet(request, wallets.src)).json();
    expect(src.balance).toBe(10000 - 500);

    // Only one transfer row
    const transfers = await dbTransfers(request);
    expect(transfers).toHaveLength(1);
  });

  test('different keys same payload: two separate transfers executed', async ({ request, wallets }) => {
    const payload = buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: 1000,
    });

    const r1 = await createTransfer(request, payload, newIdempotencyKey());
    const r2 = await createTransfer(request, payload, newIdempotencyKey());

    expect(r1.status()).toBe(201);
    expect(r2.status()).toBe(201);

    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.id).not.toBe(b2.id);

    const src = await (await getWallet(request, wallets.src)).json();
    expect(src.balance).toBe(10000 - 2000);

    const transfers = await dbTransfers(request);
    expect(transfers).toHaveLength(2);
  });

  test('retry after insufficient balance: remains rejected', async ({ request, wallets }) => {
    const key = newIdempotencyKey();
    const payload = buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: 99999,
    });

    // Note: insufficient balance means no idempotency key stored, so each retry hits the same validation
    const r1 = await createTransfer(request, payload, key);
    const r2 = await createTransfer(request, payload, key);

    expect(r1.status()).toBe(422);
    expect(r2.status()).toBe(422);

    const src = await (await getWallet(request, wallets.src)).json();
    expect(src.balance).toBe(10000); // unchanged
  });

});
