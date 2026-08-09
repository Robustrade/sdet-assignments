import { test, expect } from '../../fixtures';
import { buildTransferRequest, generateIdempotencyKey } from '../../helpers/builders';

// ── Happy Path ────────────────────────────────────────────────────────────────

test.describe('Happy Path Transfer', () => {
  test('returns 201 COMPLETED with full transfer payload', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const amount = 2_500;
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (5000), amount=${amount}`);

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
    console.log(`[assert] POST → ${res.status()}, id=${body.id}, status=${body.status}, currency=${body.currency}`);
  });

  test('debits source wallet by exact transfer amount', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const amount = 3_000;
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (5000), transferring ${amount}`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    const srcBalance = db.getWallet(sourceId).balance;
    expect(srcBalance).toBe(10_000 - amount);
    console.log(`[assert] src balance=${srcBalance} (expected ${10_000 - amount}) ✓`);
  });




  test('credits destination wallet by exact transfer amount', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const amount = 3_000;
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (5000), transferring ${amount}`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    const dstBalance = db.getWallet(destId).balance;
    expect(dstBalance).toBe(5_000 + amount);
    console.log(`[assert] dst balance=${dstBalance} (expected ${5_000 + amount}) ✓`);
  });

  test('persists a COMPLETED transfer record with all required fields', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const amount = 1_500;
    const reference = 'inv-001';
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (0), amount=${amount}, ref=${reference}`);

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
    console.log(`[assert] DB transfer id=${id}, status=${transfer.status}, amount=${transfer.amount}, ref=${transfer.reference}`);
  });

  test('GET /transfers/:id returns the persisted transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);

    const createRes = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId }),
      generateIdempotencyKey(),
    );
    const { id } = await createRes.json();
    console.log(`[setup] transfer created id=${id}`);

    const getRes = await apiClient.getTransfer(id);
    expect(getRes.status()).toBe(200);

    const transfer = await getRes.json();
    expect(transfer.id).toBe(id);
    expect(transfer.status).toBe('COMPLETED');
    console.log(`[assert] GET /transfers/${id} → ${getRes.status()}, status=${transfer.status} ✓`);
  });

  test('GET /wallets/:id reflects updated balance after transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(8_000, 2_000);
    const amount = 3_000;
    console.log(`[setup] src=${sourceId} (8000), dst=${destId} (2000), amount=${amount}`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    const [srcRes, dstRes] = await Promise.all([
      apiClient.getWallet(sourceId),
      apiClient.getWallet(destId),
    ]);

    const srcBal = (await srcRes.json()).balance;
    const dstBal = (await dstRes.json()).balance;
    expect(srcBal).toBe(8_000 - amount);
    expect(dstBal).toBe(2_000 + amount);
    console.log(`[assert] GET /wallets → src=${srcBal} (expected ${8_000 - amount}), dst=${dstBal} (expected ${2_000 + amount}) ✓`);
  });

  test('GET /transfers/:id returns 404 for unknown transfer id', async ({ apiClient }) => {
    const res = await apiClient.getTransfer('does-not-exist');
    expect(res.status()).toBe(404);
    console.log(`[assert] GET /transfers/does-not-exist → ${res.status()} ✓`);
  });

  test('GET /wallets/:id returns 404 for unknown wallet id', async ({ apiClient }) => {
    const res = await apiClient.getWallet('does-not-exist');
    expect(res.status()).toBe(404);
    console.log(`[assert] GET /wallets/does-not-exist → ${res.status()} ✓`);
  });

  test('net balance across all wallets is conserved after transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 5_000);
    const totalBefore = db.getWallet(sourceId).balance + db.getWallet(destId).balance;
    console.log(`[setup] total balance before=${totalBefore}, transferring 4000`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 4_000 }),
      generateIdempotencyKey(),
    );

    const totalAfter = db.getWallet(sourceId).balance + db.getWallet(destId).balance;
    expect(totalAfter).toBe(totalBefore);
    console.log(`[assert] total balance after=${totalAfter} (unchanged) ✓`);
  });
});

// ── Insufficient Balance ──────────────────────────────────────────────────────

test.describe('Insufficient Balance', () => {
  test('returns 422 INSUFFICIENT_BALANCE when source balance is too low', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(500, 10_000);
    console.log(`[setup] src=${sourceId} (500), dst=${destId} (10000), attempting 5000 — should reject`);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
      generateIdempotencyKey(),
    );

    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.error).toBe('INSUFFICIENT_BALANCE');
    console.log(`[assert] POST → ${res.status()} ${body.error} ✓`);
  });

  test('source wallet balance is unchanged after rejected transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(100, 10_000);
    console.log(`[setup] src=${sourceId} (100), attempting 9999`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      generateIdempotencyKey(),
    );

    const srcBalance = db.getWallet(sourceId).balance;
    expect(srcBalance).toBe(100);
    console.log(`[assert] src balance=${srcBalance} (unchanged) ✓`);
  });

  test('destination wallet balance is unchanged after rejected transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(100, 10_000);
    console.log(`[setup] dst=${destId} (10000), transfer rejected`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      generateIdempotencyKey(),
    );

    const dstBalance = db.getWallet(destId).balance;
    expect(dstBalance).toBe(10_000);
    console.log(`[assert] dst balance=${dstBalance} (unchanged) ✓`);
  });

  test('no transfer row is created for a rejected transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(50, 10_000);
    console.log(`[setup] src=${sourceId} (50), attempting 5000 — expect no DB row`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
      generateIdempotencyKey(),
    );

    const count = db.countTransfersForWallet(sourceId);
    expect(count).toBe(0);
    console.log(`[assert] transfer row count=${count} ✓`);
  });

  test('exact-balance transfer succeeds (boundary condition)', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(1_000, 0);
    console.log(`[setup] src=${sourceId} (1000), dst=${destId} (0), amount=1000 (exact balance)`);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 }),
      generateIdempotencyKey(),
    );

    expect(res.status()).toBe(201);
    expect(db.getWallet(sourceId).balance).toBe(0);
    expect(db.getWallet(destId).balance).toBe(1_000);
    console.log(`[assert] POST → ${res.status()}, src balance=0, dst balance=1000 ✓`);
  });
});
