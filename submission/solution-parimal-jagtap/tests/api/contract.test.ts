import { test, expect } from '../../fixtures/base';
import { validTransfer, idempotencyKey } from '../../helpers/test-data-factory';

/**
 * API Contract & Validation Tests
 *
 * Validates request/response shape, status codes,
 * error handling, and duplicate replay behavior.
 */

test.describe('API — Contract & Validation', () => {

  test('POST /transfers returns 201 with correct response shape', async ({ api }) => {
    const payload = validTransfer();
    const res = await api.createTransfer(payload);

    expect(res.status()).toBe(201);
    const body = await res.json();

    expect(body.transfer_id).toBeTruthy();
    expect(body.status).toBe('COMPLETED');
    expect(body.amount).toBe(payload.amount);
    expect(body.currency).toBe(payload.currency);
    expect(body.source_wallet_id).toBe(payload.source_wallet_id);
    expect(body.destination_wallet_id).toBe(payload.destination_wallet_id);
    expect(body.reference).toBe(payload.reference);
    expect(body.created_at).toBeTruthy();
    expect(body.updated_at).toBeTruthy();
  });

  test('GET /transfers/:id returns correct transfer', async ({ api }) => {
    const payload = validTransfer();
    const createRes = await api.createTransfer(payload);
    const { transfer_id } = await createRes.json();

    const getRes = await api.getTransfer(transfer_id);
    expect(getRes.status()).toBe(200);

    const body = await getRes.json();
    expect(body.transfer_id).toBe(transfer_id);
    expect(body.amount).toBe(payload.amount);
  });

  test('GET /transfers/:id returns 404 for unknown transfer', async ({ api }) => {
    const res = await api.getTransfer('nonexistent_transfer_id');
    expect(res.status()).toBe(404);
  });

  test('GET /wallets/:id returns correct wallet', async ({ api }) => {
    const res = await api.getWallet('wallet_001');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.wallet_id).toBe('wallet_001');
    expect(typeof body.balance).toBe('number');
  });

  test('GET /wallets/:id returns 404 for unknown wallet', async ({ api }) => {
    const res = await api.getWallet('nonexistent_wallet');
    expect(res.status()).toBe(404);
  });

  test('missing required fields returns 400 with field-level errors', async ({ api }) => {
    const res = await api.createTransfer({} as any);
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('validation_failed');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  test('invalid currency returns 400', async ({ api }) => {
    const res = await api.createTransfer(validTransfer({ currency: 'FAKE' }));
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(body.errors.some((e: any) => e.field === 'currency')).toBe(true);
  });

  test('zero amount returns 400', async ({ api }) => {
    const res = await api.createTransfer(validTransfer({ amount: 0 }));
    expect(res.status()).toBe(400);
  });

  test('negative amount returns 400', async ({ api }) => {
    const res = await api.createTransfer(validTransfer({ amount: -100 }));
    expect(res.status()).toBe(400);
  });

  test('same source and destination wallet returns 400', async ({ api }) => {
    const res = await api.createTransfer(validTransfer({
      source_wallet_id: 'wallet_001',
      destination_wallet_id: 'wallet_001',
    }));
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.errors.some((e: any) => e.field === 'destination_wallet_id')).toBe(true);
  });

  test('duplicate replay with same idempotency key returns original transfer', async ({ api }) => {
    const key = idempotencyKey();
    const payload = validTransfer();

    const res1 = await api.createTransfer(payload, key);
    const body1 = await res1.json();
    expect(res1.status()).toBe(201);

    // Replay same request
    const res2 = await api.createTransfer(payload, key);
    const body2 = await res2.json();
    expect(res2.status()).toBe(200);

    // Must return same transfer
    expect(body2.transfer_id).toBe(body1.transfer_id);
    expect(body2.amount).toBe(body1.amount);
  });

  test('same idempotency key with different payload returns 422', async ({ api }) => {
    const key = idempotencyKey();

    await api.createTransfer(validTransfer({ amount: 100 }), key);
    const res2 = await api.createTransfer(validTransfer({ amount: 200 }), key);

    expect(res2.status()).toBe(422);
    const body = await res2.json();
    expect(body.error).toBe('idempotency_conflict');
  });

});
