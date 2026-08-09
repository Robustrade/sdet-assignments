// tests/api/api-contract.spec.js
const { expect } = require('@playwright/test');
const { test }   = require('../../fixtures/wallet-fixture');
const {
  createTransfer, getTransfer, getWallet,
} = require('../../utils/api-client');
const { buildTransferPayload, newIdempotencyKey } = require('../../utils/data-builders');

test.describe('API Contract & Validation', () => {

  // ── Happy path ──────────────────────────────────────────────────────────────
  test('201: successful transfer returns correct shape', async ({ request, wallets }) => {
    const payload = buildTransferPayload({
      source_wallet_id:      wallets.src,
      destination_wallet_id: wallets.dst,
    });
    const res = await createTransfer(request, payload, newIdempotencyKey());

    expect(res.status()).toBe(201);
    const body = await res.json();

    expect(body).toMatchObject({
      source_wallet_id:      wallets.src,
      destination_wallet_id: wallets.dst,
      amount:                2500,
      currency:              'AED',
      status:                'COMPLETED',
    });
    expect(body.id).toBeTruthy();
    expect(body.created_at).toBeTruthy();
  });

  // ── GET /transfers/:id
  test('200: GET /transfers/:id returns the transfer', async ({ request, wallets }) => {
    const payload = buildTransferPayload({
      source_wallet_id:      wallets.src,
      destination_wallet_id: wallets.dst,
    });
    const createRes = await createTransfer(request, payload, newIdempotencyKey());
    const created   = await createRes.json();

    const getRes = await getTransfer(request, created.id);
    expect(getRes.status()).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.id).toBe(created.id);
    expect(fetched.status).toBe('COMPLETED');
  });

  test('404: GET /transfers/:id for unknown id', async ({ request }) => {
    const res = await getTransfer(request, 'nonexistent-id');
    expect(res.status()).toBe(404);
  });

  // ── Validation failures
  test('400: missing source_wallet_id', async ({ request, wallets }) => {
    const res = await createTransfer(request, {
      destination_wallet_id: wallets.dst, amount: 100, currency: 'AED',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  test('400: missing destination_wallet_id', async ({ request, wallets }) => {
    const res = await createTransfer(request, {
      source_wallet_id: wallets.src, amount: 100, currency: 'AED',
    });
    expect(res.status()).toBe(400);
  });

  test('400: missing amount', async ({ request, wallets }) => {
    const res = await createTransfer(request, {
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, currency: 'AED',
    });
    expect(res.status()).toBe(400);
  });

  test('400: zero amount', async ({ request, wallets }) => {
    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id:      wallets.src,
      destination_wallet_id: wallets.dst,
      amount: 0,
    }));
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  test('400: negative amount', async ({ request, wallets }) => {
    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id:      wallets.src,
      destination_wallet_id: wallets.dst,
      amount: -500,
    }));
    expect(res.status()).toBe(400);
  });

  test('400: same source and destination wallet', async ({ request, wallets }) => {
    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id:      wallets.src,
      destination_wallet_id: wallets.src,
    }));
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  test('400: invalid currency', async ({ request, wallets }) => {
    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id:      wallets.src,
      destination_wallet_id: wallets.dst,
      currency: 'XYZ',
    }));
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_CURRENCY');
  });

  test('404: source wallet not found', async ({ request, wallets }) => {
    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id:      'wallet_does_not_exist',
      destination_wallet_id: wallets.dst,
    }));
    expect(res.status()).toBe(404);
    expect((await res.json()).code).toBe('WALLET_NOT_FOUND');
  });

  test('404: destination wallet not found', async ({ request, wallets }) => {
    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id:      wallets.src,
      destination_wallet_id: 'wallet_does_not_exist',
    }));
    expect(res.status()).toBe(404);
  });

  // ── Insufficient balance ─────────────────────────────────────────────────────
  test('422: insufficient balance returns correct code', async ({ request, wallets }) => {
    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id:      wallets.src,
      destination_wallet_id: wallets.dst,
      amount: 99999,       // more than 10000 balance
    }));
    expect(res.status()).toBe(422);
    expect((await res.json()).code).toBe('INSUFFICIENT_BALANCE');
  });

  // ── Idempotency conflict ─────────────────────────────────────────────────────
  test('409: same idempotency key with different payload is rejected', async ({ request, wallets }) => {
    const key = newIdempotencyKey();
    await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: 100,
    }), key);

    const res = await createTransfer(request, buildTransferPayload({
      source_wallet_id: wallets.src, destination_wallet_id: wallets.dst, amount: 200, // different!
    }), key);

    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('IDEMPOTENCY_CONFLICT');
  });

});
