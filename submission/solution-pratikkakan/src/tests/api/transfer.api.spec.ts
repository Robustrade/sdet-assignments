import { test, expect } from '../../fixtures';
import { buildTransferRequest, generateIdempotencyKey } from '../../helpers/builders';

// ── Happy Path ────────────────────────────────────────────────────────────────

test.describe('Happy Path Transfer', () => {
  test('returns 201 COMPLETED with full transfer payload', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const amount = 2_500;

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.status).toBe('COMPLETED');
    expect(typeof body.id).toBe('string');
    expect(body.source_wallet_id).toBe(sourceId);
    expect(body.destination_wallet_id).toBe(destId);
    expect(body.amount).toBe(amount);
    expect(body.currency).toBe('AED');
  });

  test('debits source wallet by exact transfer amount', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const amount = 3_000;

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    expect(db.getWallet(sourceId).balance).toBe(10_000 - amount);
  });

  test('credits destination wallet by exact transfer amount', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const amount = 3_000;

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    expect(db.getWallet(destId).balance).toBe(5_000 + amount);
  });

  test('persists a COMPLETED transfer record with all required fields', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const amount = 1_500;
    const reference = 'inv-001';

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount, reference }),
      generateIdempotencyKey(),
    );

    const { id } = await res.json();
    const transfer = db.getTransfer(id);

    expect(transfer.status).toBe('COMPLETED');
    expect(transfer.amount).toBe(amount);
    expect(transfer.source_wallet_id).toBe(sourceId);
    expect(transfer.destination_wallet_id).toBe(destId);
    expect(transfer.reference).toBe(reference);
    expect(transfer.created_at).toBeTruthy();
    expect(transfer.updated_at).toBeTruthy();
  });

  test('GET /transfers/:id returns the persisted transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);

    const createRes = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId }),
      generateIdempotencyKey(),
    );
    const { id } = await createRes.json();

    const getRes = await apiClient.getTransfer(id);
    expect(getRes.status()).toBe(200);

    const transfer = await getRes.json();
    expect(transfer.id).toBe(id);
    expect(transfer.status).toBe('COMPLETED');
  });

  test('GET /wallets/:id reflects updated balance after transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(8_000, 2_000);
    const amount = 3_000;

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    const [srcRes, dstRes] = await Promise.all([
      apiClient.getWallet(sourceId),
      apiClient.getWallet(destId),
    ]);

    expect((await srcRes.json()).balance).toBe(8_000 - amount);
    expect((await dstRes.json()).balance).toBe(2_000 + amount);
  });

  test('GET /transfers/:id returns 404 for unknown transfer id', async ({ apiClient }) => {
    const res = await apiClient.getTransfer('does-not-exist');
    expect(res.status()).toBe(404);
  });

  test('GET /wallets/:id returns 404 for unknown wallet id', async ({ apiClient }) => {
    const res = await apiClient.getWallet('does-not-exist');
    expect(res.status()).toBe(404);
  });

  test('net balance across all wallets is conserved after transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const totalBefore = db.getWallet(sourceId).balance + db.getWallet(destId).balance;

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 4_000 }),
      generateIdempotencyKey(),
    );

    const totalAfter = db.getWallet(sourceId).balance + db.getWallet(destId).balance;
    expect(totalAfter).toBe(totalBefore);
  });
});

// ── Insufficient Balance ──────────────────────────────────────────────────────

test.describe('Insufficient Balance', () => {
  test('returns 422 INSUFFICIENT_BALANCE when source balance is too low', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(500, 10_000);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
      generateIdempotencyKey(),
    );

    expect(res.status()).toBe(422);
    expect((await res.json()).error).toBe('INSUFFICIENT_BALANCE');
  });

  test('source wallet balance is unchanged after rejected transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(100, 10_000);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      generateIdempotencyKey(),
    );

    expect(db.getWallet(sourceId).balance).toBe(100);
  });

  test('destination wallet balance is unchanged after rejected transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(100, 10_000);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      generateIdempotencyKey(),
    );

    expect(db.getWallet(destId).balance).toBe(10_000);
  });

  test('no transfer row is created for a rejected transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(50, 10_000);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
      generateIdempotencyKey(),
    );

    expect(db.countTransfersForWallet(sourceId)).toBe(0);
  });

  test('exact-balance transfer succeeds (boundary condition)', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(1_000, 0);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 }),
      generateIdempotencyKey(),
    );

    expect(res.status()).toBe(201);
    expect(db.getWallet(sourceId).balance).toBe(0);
    expect(db.getWallet(destId).balance).toBe(1_000);
  });
});
