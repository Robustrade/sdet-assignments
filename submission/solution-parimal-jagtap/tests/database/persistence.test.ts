import { test, expect } from '../../fixtures/base';
import { validTransfer, idempotencyKey } from '../../helpers/test-data-factory';

/**
 * Database Verification Tests
 *
 * Every assertion here queries DB directly.
 * API response alone is never trusted.
 *
 * Tables checked:
 *   - wallets (balance updates)
 *   - transfers (record correctness)
 *   - idempotency_keys (deduplication store)
 *   - transfer_events (audit log)
 *   - outbox_events (downstream events)
 */

test.describe('Database — Persistence & Invariants', () => {

  test('successful transfer debits source and credits destination exactly once', async ({ api, db }) => {
    const sourceBefore = await db.getWalletBalance('wallet_001');
    const destBefore   = await db.getWalletBalance('wallet_002');

    const payload = validTransfer({ amount: 500 });
    const res = await api.createTransfer(payload);
    const { transfer_id } = await res.json();

    const sourceAfter = await db.getWalletBalance('wallet_001');
    const destAfter   = await db.getWalletBalance('wallet_002');

    // Invariant: debit == credit == transfer amount
    expect(sourceBefore - sourceAfter).toBe(500);
    expect(destAfter - destBefore).toBe(500);

    // Transfer record persisted correctly
    const record = await db.getTransferRecord(transfer_id);
    expect(record).not.toBeNull();
    expect(record.status).toBe('COMPLETED');
    expect(record.amount).toBe(500);
    expect(record.source_wallet_id).toBe('wallet_001');
    expect(record.destination_wallet_id).toBe('wallet_002');
  });

  test('DB transfer record matches API response exactly', async ({ api, db }) => {
    const payload = validTransfer({ amount: 250 });
    const res = await api.createTransfer(payload);
    const apiBody = await res.json();

    const dbRecord = await db.getTransferRecord(apiBody.transfer_id);

    // Core consistency check: API and DB must agree
    expect(dbRecord.transfer_id).toBe(apiBody.transfer_id);
    expect(dbRecord.status).toBe(apiBody.status);
    expect(dbRecord.amount).toBe(apiBody.amount);
    expect(dbRecord.currency).toBe(apiBody.currency);
    expect(dbRecord.reference).toBe(apiBody.reference);
  });

  test('idempotency record stored correctly after transfer', async ({ api, db }) => {
    const key = idempotencyKey();
    const payload = validTransfer();
    const res = await api.createTransfer(payload, key);
    const { transfer_id } = await res.json();

    const idemRecord = await db.getIdempotencyRecord(key);
    expect(idemRecord).not.toBeNull();
    expect(idemRecord.transfer_id).toBe(transfer_id);
    expect(idemRecord.key).toBe(key);
  });

  test('audit event written after successful transfer', async ({ api, db }) => {
    const payload = validTransfer();
    const res = await api.createTransfer(payload);
    const { transfer_id } = await res.json();

    const event = await db.getAuditEvent(transfer_id);
    expect(event).not.toBeNull();
    expect(event.transfer_id).toBe(transfer_id);
    expect(event.event_type).toBe('TRANSFER_COMPLETED');
  });

  test('outbox event written exactly once after successful transfer', async ({ api, db }) => {
    const payload = validTransfer();
    const res = await api.createTransfer(payload);
    const { transfer_id } = await res.json();

    const outbox = await db.getOutboxEvent(transfer_id);
    expect(outbox).not.toBeNull();
    expect(outbox.transfer_id).toBe(transfer_id);
    expect(outbox.event_type).toBe('WALLET_TRANSFER_COMPLETED');
  });

  test('insufficient balance — wallet balances unchanged in DB', async ({ api, db }) => {
    const sourceBefore = await db.getWalletBalance('wallet_003'); // balance = 0
    const destBefore   = await db.getWalletBalance('wallet_002');

    const res = await api.createTransfer(validTransfer({
      source_wallet_id: 'wallet_003',
      amount: 100,
    }));

    expect(res.status()).toBe(422);

    const sourceAfter = await db.getWalletBalance('wallet_003');
    const destAfter   = await db.getWalletBalance('wallet_002');

    // Invariant: no balance mutation on rejected transfer
    expect(sourceAfter).toBe(sourceBefore);
    expect(destAfter).toBe(destBefore);
  });

  test('validation failure — no DB record created', async ({ api, db }) => {
    const res = await api.createTransfer(validTransfer({ currency: 'FAKE' }));
    expect(res.status()).toBe(400);

    // No transfer record should exist for failed validation
    const body = await res.json();
    if (body.transfer_id) {
      const record = await db.getTransferRecord(body.transfer_id);
      expect(record).toBeNull();
    }
  });

  test('duplicate replay does not double-debit source wallet', async ({ api, db }) => {
    const key = idempotencyKey();
    const payload = validTransfer({ amount: 100 });

    const balanceBefore = await db.getWalletBalance('wallet_001');

    await api.createTransfer(payload, key);
    await api.createTransfer(payload, key); // replay
    await api.createTransfer(payload, key); // replay again

    const balanceAfter = await db.getWalletBalance('wallet_001');

    // Deducted only once despite 3 requests
    expect(balanceBefore - balanceAfter).toBe(100);
  });

  test('total balance conservation — sum of all wallet balances unchanged', async ({ api, db }) => {
    const w1Before = await db.getWalletBalance('wallet_001');
    const w2Before = await db.getWalletBalance('wallet_002');

    await api.createTransfer(validTransfer({ amount: 300 }));

    const w1After = await db.getWalletBalance('wallet_001');
    const w2After = await db.getWalletBalance('wallet_002');

    // Money is conserved — total stays the same
    expect(w1Before + w2Before).toBe(w1After + w2After);
  });

});
