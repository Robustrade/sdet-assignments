import { test, expect } from '../../fixtures';
import { buildTransferRequest, generateIdempotencyKey } from '../../helpers/builders';

/**
 * All validation tests assert TWO things:
 *   1. The API returns the expected error response.
 *   2. No DB side effects (no transfer row, no balance mutation).
 *
 * Tests seed a unique wallet pair so balance assertions are unambiguous.
 */

const IDEMPOTENCY_KEY = () => generateIdempotencyKey();

// ── Missing required fields ───────────────────────────────────────────────────

test('missing source_wallet_id → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { destId } = db.seedTestWallets(10_000, 0);
  console.log(`[action] POST /transfers with missing source_wallet_id`);

  const res = await apiClient.createTransferRaw(
    { destination_wallet_id: destId, amount: 500, currency: 'AED' },
    { 'Idempotency-Key': IDEMPOTENCY_KEY() },
  );

  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('VALIDATION_ERROR');
  expect(body.fields).toContain('source_wallet_id');
  expect(db.countTransfersForWallet(destId)).toBe(0);
  console.log(`[assert] → ${res.status()} ${body.error}, fields=${body.fields}, no DB row ✓`);
});

test('missing destination_wallet_id → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { sourceId } = db.seedTestWallets(10_000, 0);
  const balanceBefore = db.getWallet(sourceId).balance;
  console.log(`[action] POST /transfers with missing destination_wallet_id`);

  const res = await apiClient.createTransferRaw(
    { source_wallet_id: sourceId, amount: 500, currency: 'AED' },
    { 'Idempotency-Key': IDEMPOTENCY_KEY() },
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('VALIDATION_ERROR');
  expect(db.getWallet(sourceId).balance).toBe(balanceBefore);
  console.log(`[assert] → ${res.status()} ${body.error}, src balance unchanged (${balanceBefore}) ✓`);
});

test('missing amount → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { sourceId, destId } = db.seedTestWallets(10_000, 0);
  console.log(`[action] POST /transfers with missing amount`);

  const res = await apiClient.createTransferRaw(
    { source_wallet_id: sourceId, destination_wallet_id: destId, currency: 'AED' },
    { 'Idempotency-Key': IDEMPOTENCY_KEY() },
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('VALIDATION_ERROR');
  console.log(`[assert] → ${res.status()} ${body.error} ✓`);
});

test('missing currency → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { sourceId, destId } = db.seedTestWallets(10_000, 0);
  console.log(`[action] POST /transfers with missing currency`);

  const res = await apiClient.createTransferRaw(
    { source_wallet_id: sourceId, destination_wallet_id: destId, amount: 500 },
    { 'Idempotency-Key': IDEMPOTENCY_KEY() },
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('VALIDATION_ERROR');
  console.log(`[assert] → ${res.status()} ${body.error} ✓`);
});

// ── Invalid field values ──────────────────────────────────────────────────────

test('amount = 0 → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { sourceId, destId } = db.seedTestWallets(10_000, 0);
  console.log(`[action] POST /transfers with amount=0`);

  const res = await apiClient.createTransfer(
    buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 0 }),
    IDEMPOTENCY_KEY(),
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('VALIDATION_ERROR');
  expect(db.countTransfersForWallet(sourceId)).toBe(0);
  console.log(`[assert] → ${res.status()} ${body.error}, no DB row ✓`);
});

test('amount < 0 (negative) → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { sourceId, destId } = db.seedTestWallets(10_000, 0);
  console.log(`[action] POST /transfers with amount=-500`);

  const res = await apiClient.createTransfer(
    buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: -500 }),
    IDEMPOTENCY_KEY(),
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('VALIDATION_ERROR');
  expect(db.countTransfersForWallet(sourceId)).toBe(0);
  console.log(`[assert] → ${res.status()} ${body.error}, no DB row ✓`);
});

test('non-integer amount → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { sourceId, destId } = db.seedTestWallets(10_000, 0);
  console.log(`[action] POST /transfers with amount=10.5 (float)`);

  const res = await apiClient.createTransferRaw(
    { source_wallet_id: sourceId, destination_wallet_id: destId, amount: 10.5, currency: 'AED' },
    { 'Idempotency-Key': IDEMPOTENCY_KEY() },
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('VALIDATION_ERROR');
  console.log(`[assert] → ${res.status()} ${body.error} ✓`);
});

test('invalid currency (XYZ) → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { sourceId, destId } = db.seedTestWallets(10_000, 0);
  console.log(`[action] POST /transfers with currency=XYZ`);

  const res = await apiClient.createTransfer(
    buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, currency: 'XYZ' }),
    IDEMPOTENCY_KEY(),
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('VALIDATION_ERROR');
  expect(db.countTransfersForWallet(sourceId)).toBe(0);
  console.log(`[assert] → ${res.status()} ${body.error}, no DB row ✓`);
});

test('same source and destination wallet → 400 VALIDATION_ERROR', async ({ apiClient, db }) => {
  const { sourceId } = db.seedTestWallets(10_000, 0);
  const balanceBefore = db.getWallet(sourceId).balance;
  console.log(`[action] POST /transfers with src=dst=${sourceId} (self-transfer)`);

  const res = await apiClient.createTransfer(
    buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: sourceId }),
    IDEMPOTENCY_KEY(),
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('VALIDATION_ERROR');
  expect(db.getWallet(sourceId).balance).toBe(balanceBefore);
  console.log(`[assert] → ${res.status()} ${body.error}, balance unchanged (${balanceBefore}) ✓`);
});

// ── Missing idempotency key ───────────────────────────────────────────────────

test('missing Idempotency-Key header → 400 MISSING_IDEMPOTENCY_KEY', async ({ apiClient, db }) => {
  const { sourceId, destId } = db.seedTestWallets(10_000, 0);
  const balanceBefore = db.getWallet(sourceId).balance;
  console.log(`[action] POST /transfers without Idempotency-Key header`);

  // Deliberately omit idempotency key header
  const res = await apiClient.createTransferRaw(
    buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId }),
    // no headers
  );

  const body = await res.json();
  expect(res.status()).toBe(400);
  expect(body.error).toBe('MISSING_IDEMPOTENCY_KEY');
  expect(db.getWallet(sourceId).balance).toBe(balanceBefore);
  expect(db.countTransfersForWallet(sourceId)).toBe(0);
  console.log(`[assert] → ${res.status()} ${body.error}, balance unchanged, no DB row ✓`);
});

// ── No DB side effects for any validation failure ─────────────────────────────

test('validation failures leave wallets completely untouched', async ({ apiClient, db }) => {
  const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
  console.log(`[setup] src=${sourceId} (10000), dst=${destId} (5000), firing 3 invalid requests`);

  // Fire multiple invalid requests
  await Promise.all([
    apiClient.createTransferRaw({ source_wallet_id: sourceId, amount: 100 }, { 'Idempotency-Key': IDEMPOTENCY_KEY() }),
    apiClient.createTransfer(buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 0 }), IDEMPOTENCY_KEY()),
    apiClient.createTransfer(buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, currency: 'ZZZ' }), IDEMPOTENCY_KEY()),
  ]);

  expect(db.getWallet(sourceId).balance).toBe(10_000);
  expect(db.getWallet(destId).balance).toBe(5_000);
  expect(db.countTransfersForWallet(sourceId)).toBe(0);
  console.log(`[assert] all wallets untouched: src=10000, dst=5000, transfer count=0 ✓`);
});
