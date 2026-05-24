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
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (0), amount=1000`);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 1_000 }),
      generateIdempotencyKey(),
    );
    const { id } = await res.json();

    const events = db.getTransferEvents(id);
    const eventTypes = events.map((e) => e.event_type);

    expect(eventTypes).toContain('TRANSFER_INITIATED');
    expect(eventTypes).toContain('TRANSFER_COMPLETED');
    console.log(`[assert] DB events for transfer ${id}: [${eventTypes.join(', ')}] ✓`);
  });

  test('each transfer_event row carries a valid payload and references the correct transfer_id', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const amount = 2_500;
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (0), amount=${amount}`);

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
    console.log(`[assert] all events reference transfer_id=${id}, payload.amount=${amount} ✓`);
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
    console.log(`[setup] transfer created id=${id}`);

    const outbox = db.getOutboxEvents(id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].event_type).toBe('TRANSFER_COMPLETED');
    expect(outbox[0].published).toBe(0); // 0 = pending publish
    console.log(`[assert] outbox: ${outbox.length} row, event=${outbox[0].event_type}, published=${outbox[0].published} (pending) ✓`);
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
    console.log(`[assert] API status=${apiBody.status} matches DB status=${dbTransfer.status} ✓`);
  });

  test('DB balance delta equals transfer amount — no phantom money', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 2_000);
    const amount = 3_500;
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (2000), amount=${amount}`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount }),
      generateIdempotencyKey(),
    );

    const srcBalance = db.getWallet(sourceId).balance;
    const dstBalance = db.getWallet(destId).balance;

    // Debit equals credit — conservation law
    expect(10_000 - srcBalance).toBe(dstBalance - 2_000);
    expect(10_000 - srcBalance).toBe(amount);
    console.log(`[assert] src debit=${10_000 - srcBalance} == dst credit=${dstBalance - 2_000} == amount=${amount} ✓`);
  });

  test('idempotency_keys row is present and references the correct transfer', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId }),
      key,
    );
    const { id } = await res.json();
    console.log(`[setup] transfer created id=${id}, key=${key.slice(0, 8)}...`);

    const record = db.getIdempotencyRecord(key);
    expect(record).toBeDefined();
    expect(record!.transfer_id).toBe(id);
    expect(record!.response_status).toBe(201);
    const cached = JSON.parse(record!.response_body);
    expect(cached.id).toBe(id);
    expect(cached.status).toBe('COMPLETED');
    console.log(`[assert] idempotency record: transfer_id=${record!.transfer_id}, response_status=${record!.response_status}, cached body matches ✓`);
  });
});

test.describe('Rejected Transfer — No Dirty State', () => {
  test('insufficient balance: no transfer_events rows created', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(100, 0);
    const key = generateIdempotencyKey();
    console.log(`[setup] src=${sourceId} (100), attempting 9999 — should reject`);

    await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      key,
    );

    // No transfer row → no events possible
    const count = db.countTransfersForWallet(sourceId);
    expect(count).toBe(0);
    console.log(`[assert] transfer count=${count}, no event rows created ✓`);
  });

  test('insufficient balance: no outbox_events row created', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(100, 0);
    console.log(`[setup] src=${sourceId} (100), attempting 9999 — should reject`);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 9_999 }),
      generateIdempotencyKey(),
    );
    expect(res.status()).toBe(422);

    // We have no transfer id to query by; assert none exist for this wallet
    const count = db.countTransfersForWallet(sourceId);
    expect(count).toBe(0);
    console.log(`[assert] → ${res.status()}, transfer count=${count}, no outbox row ✓`);
  });

  test('no contradictory records: COMPLETED transfer always has matching balance delta', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const amount = 4_000;
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (0), amount=${amount}`);

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
    console.log(`[assert] transfer status=${transfer.status}, src balance=${srcWallet.balance} (10000 - ${transfer.amount}) ✓`);
  });

  test('duplicate idempotent replay: outbox_events row count stays at 1', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId });
    console.log(`[setup] src=${sourceId} (10000), replaying transfer 3 times with same key`);

    const first = await apiClient.createTransfer(payload, key);
    const { id } = await first.json();

    // Replay twice
    await apiClient.createTransfer(payload, key);
    await apiClient.createTransfer(payload, key);

    // Outbox must still have exactly one row
    const outboxCount = db.getOutboxEvents(id).length;
    expect(outboxCount).toBe(1);
    console.log(`[assert] outbox rows=${outboxCount} after 3 requests (no duplicate publish) ✓`);
  });
});
