// tests/db/db-persistence.spec.js
const { expect } = require('@playwright/test');
const { test }   = require('../../fixtures/wallet-fixture');
const {
  createTransfer,
  dbWallets, dbTransfers, dbIdempotencyKeys, dbTransferEvents, dbOutboxEvents,
} = require('../../utils/api-client');
const { buildTransferPayload, newIdempotencyKey } = require('../../utils/data-builders');

test.describe('Database Persistence & Invariants', () => {

  test('wallet balances are updated exactly once on success', async ({ request, wallets }) => {
    const AMOUNT = 3000;
    const beforeSrc = (await (await require('../../utils/api-client').getWallet(request, wallets.src)).json()).balance;
    const beforeDst = (await (await require('../../utils/api-client').getWallet(request, wallets.dst)).json()).balance;

    await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: AMOUNT,
    }), newIdempotencyKey());

    const allWallets = await dbWallets(request);
    const srcRow = allWallets.find(w => w.id === wallets.src);
    const dstRow = allWallets.find(w => w.id === wallets.dst);

    // Invariant: source debited exactly AMOUNT
    expect(srcRow.balance).toBe(beforeSrc - AMOUNT);
    // Invariant: destination credited exactly AMOUNT
    expect(dstRow.balance).toBe(beforeDst + AMOUNT);
    // Invariant: total balance conserved
    expect(srcRow.balance + dstRow.balance).toBe(beforeSrc + beforeDst);
  });

  test('transfer row written with correct fields', async ({ request, wallets }) => {
    const key = newIdempotencyKey();
    const payload = buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: 1500,
    });

    const res  = await createTransfer(request, payload, key);
    const body = await res.json();

    const transfers = await dbTransfers(request);
    expect(transfers).toHaveLength(1);

    const row = transfers[0];
    expect(row.id).toBe(body.id);
    expect(row.status).toBe('COMPLETED');
    expect(row.amount).toBe(1500);
    expect(row.currency).toBe('AED');
    expect(row.source_wallet_id).toBe(wallets.src);
    expect(row.destination_wallet_id).toBe(wallets.dst);
    expect(row.idempotency_key).toBe(key);
    expect(row.created_at).toBeTruthy();
  });

  test('idempotency key row stored on success', async ({ request, wallets }) => {
    const key = newIdempotencyKey();
    const res  = await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst,
    }), key);
    const body = await res.json();

    const keys = await dbIdempotencyKeys(request);
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe(key);
    expect(keys[0].transfer_id).toBe(body.id);
  });

  test('transfer_events row written for completed transfer', async ({ request, wallets }) => {
    const res  = await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst,
    }), newIdempotencyKey());
    const body = await res.json();

    const events = await dbTransferEvents(request);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const completedEvent = events.find(e => e.transfer_id === body.id && e.event_type === 'TRANSFER_COMPLETED');
    expect(completedEvent).toBeTruthy();
  });

  test('outbox event written exactly once per successful transfer', async ({ request, wallets }) => {
    const res  = await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst,
    }), newIdempotencyKey());
    const body = await res.json();

    const outbox = await dbOutboxEvents(request);
    const relevant = outbox.filter(e => e.transfer_id === body.id);
    expect(relevant).toHaveLength(1);
    expect(relevant[0].event_type).toBe('TRANSFER_COMPLETED');
    expect(relevant[0].published).toBe(0); // not yet dispatched, queued
  });

  test('INSUFFICIENT_BALANCE: no transfer row, no balance change, no outbox event', async ({ request, wallets }) => {
    const resBefore = await dbWallets(request);
    const srcBefore = resBefore.find(w => w.id === wallets.src).balance;
    const dstBefore = resBefore.find(w => w.id === wallets.dst).balance;

    await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: 99999,
    }), newIdempotencyKey());

    const walletsAfter  = await dbWallets(request);
    const transfersAfter = await dbTransfers(request);
    const outboxAfter    = await dbOutboxEvents(request);

    expect(walletsAfter.find(w => w.id === wallets.src).balance).toBe(srcBefore);
    expect(walletsAfter.find(w => w.id === wallets.dst).balance).toBe(dstBefore);
    expect(transfersAfter).toHaveLength(0);
    expect(outboxAfter).toHaveLength(0);
  });

  test('validation error: no transfer row persisted', async ({ request, wallets }) => {
    await createTransfer(request, {
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst,
      amount: -100, currency: 'AED',
    });

    const transfers = await dbTransfers(request);
    expect(transfers).toHaveLength(0);
  });

  test('no transfer row written without idempotency key (allowed, no crash)', async ({ request, wallets }) => {
    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst,
    }));  // no idempotency key
    expect(res.status()).toBe(201);

    const transfers = await dbTransfers(request);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].idempotency_key).toBeNull();

    const keys = await dbIdempotencyKeys(request);
    expect(keys).toHaveLength(0); // no key row stored
  });

});
