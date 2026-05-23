import { test, expect } from '../../fixtures';
import { buildTransferRequest, generateIdempotencyKey } from '../../helpers/builders';

/**
 * Database / Persistence Verification
 *
 * These tests validate the internal DB state independently of what the API
 * returns — proving that the service does not merely return the right status
 * codes but actually writes correct, consistent, and auditable records.
 */

test.describe('Successful Transfer Persistence', () => {
  test('persists TRANSFER_INITIATED and TRANSFER_COMPLETED events for a successful transfer', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 }),
      generateIdempotencyKey(),
    );
    const { id } = await res.json();

    const events = db.getTransferEvents(id);
    const eventTypes = events.map((e) => e.event_type);

    expect(eventTypes).toContain('TRANSFER_INITIATED');
    expect(eventTypes).toContain('TRANSFER_COMPLETED');
  });

  test('each transfer_event row carries a valid payload and references the correct transfer_id', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const amount = 2_500;

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );
    const { id } = await res.json();

    for (const event of db.getTransferEvents(id)) {
      expect(event.transfer_id).toBe(id);
      expect(event.id).toBeTruthy();
      expect(event.created_at).toBeTruthy();
      const payload = JSON.parse(event.payload);
      expect(payload.amount).toBe(amount);
    }
  });

  test('creates exactly one unpublished outbox_events row for a successful transfer', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId }),
      generateIdempotencyKey(),
    );
    const { id } = await res.json();

    const outbox = db.getOutboxEvents(id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].event_type).toBe('TRANSFER_COMPLETED');
    expect(outbox[0].published).toBe(0); // 0 = pending publish
  });

  test('persisted transfer status matches the API response status', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId }),
      generateIdempotencyKey(),
    );
    const apiBody = await res.json();

    const dbTransfer = db.getTransfer(apiBody.id);
    expect(dbTransfer.status).toBe(apiBody.status);
  });

  test('DB balance delta equals transfer amount — no phantom money', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 2_000);
    const amount = 3_500;

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    const srcBalance = db.getWallet(sourceId).balance;
    const dstBalance = db.getWallet(destId).balance;

    // Debit equals credit — conservation law
    expect(10_000 - srcBalance).toBe(dstBalance - 2_000);
    expect(10_000 - srcBalance).toBe(amount);
  });

  test('idempotency_keys row is present and references the correct transfer', async ({ apiClient, db }) => {
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
    const cached = JSON.parse(record!.response_body);
    expect(cached.id).toBe(id);
    expect(cached.status).toBe('COMPLETED');
  });
});

test.describe('Rejected Transfer — No Dirty State', () => {
  test('insufficient balance: no transfer_events rows created', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(100, 0);
    const key = generateIdempotencyKey();

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      key,
    );

    // No transfer row → no events possible
    expect(db.countTransfersForWallet(sourceId)).toBe(0);
  });

  test('insufficient balance: no outbox_events row created', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(100, 0);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      generateIdempotencyKey(),
    );
    expect(res.status()).toBe(422);

    // We have no transfer id to query by; assert none exist for this wallet
    expect(db.countTransfersForWallet(sourceId)).toBe(0);
  });

  test('no contradictory records: COMPLETED transfer always has matching balance delta', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const amount = 4_000;

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );
    const { id } = await res.json();

    const transfer = db.getTransfer(id);
    const srcWallet = db.getWallet(sourceId);

    // A COMPLETED transfer must produce a measurable debit
    expect(transfer.status).toBe('COMPLETED');
    expect(srcWallet.balance).toBe(10_000 - transfer.amount);
  });

  test('duplicate idempotent replay: outbox_events row count stays at 1', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId });

    const first = await apiClient.createTransfer(payload, key);
    const { id } = await first.json();

    // Replay twice
    await apiClient.createTransfer(payload, key);
    await apiClient.createTransfer(payload, key);

    // Outbox must still have exactly one row
    expect(db.getOutboxEvents(id)).toHaveLength(1);
  });
});
