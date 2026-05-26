import { test, expect } from '../../fixtures/base';
import { validTransfer, idempotencyKey } from '../../helpers/test-data-factory';

/**
 * End-to-End Flow Tests
 *
 * Validates full path: API request → service processing
 * → DB persistence → audit trail → outbox event.
 *
 * These tests treat the system as a whole.
 */

test.describe('E2E — Full Transfer Flow', () => {

  test('complete happy path: transfer validated across all layers', async ({ api, db }) => {
    const key = idempotencyKey();
    const payload = validTransfer({ amount: 1000 });

    const sourceBefore = await db.getWalletBalance('wallet_001');
    const destBefore   = await db.getWalletBalance('wallet_002');

    // 1. API call
    const res = await api.createTransfer(payload, key);
    expect(res.status()).toBe(201);

    const apiBody = await res.json();
    expect(apiBody.status).toBe('COMPLETED');
    const transferId = apiBody.transfer_id;

    // 2. DB transfer record matches API response
    const dbRecord = await db.getTransferRecord(transferId);
    expect(dbRecord.status).toBe('COMPLETED');
    expect(dbRecord.amount).toBe(1000);

    // 3. Wallet balances updated correctly
    expect(await db.getWalletBalance('wallet_001')).toBe(sourceBefore - 1000);
    expect(await db.getWalletBalance('wallet_002')).toBe(destBefore + 1000);

    // 4. Idempotency record stored
    const idemRecord = await db.getIdempotencyRecord(key);
    expect(idemRecord.transfer_id).toBe(transferId);

    // 5. Audit event written
    const auditEvent = await db.getAuditEvent(transferId);
    expect(auditEvent.event_type).toBe('TRANSFER_COMPLETED');

    // 6. Outbox event written once
    const outboxEvent = await db.getOutboxEvent(transferId);
    expect(outboxEvent.event_type).toBe('WALLET_TRANSFER_COMPLETED');
  });

  test('insufficient balance: rejected at API, no DB side effects', async ({ api, db }) => {
    const sourceBefore = await db.getWalletBalance('wallet_003'); // 0 balance
    const destBefore   = await db.getWalletBalance('wallet_002');

    const res = await api.createTransfer(validTransfer({
      source_wallet_id: 'wallet_003',
      amount: 500,
    }));

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('insufficient_balance');

    // No balance mutation
    expect(await db.getWalletBalance('wallet_003')).toBe(sourceBefore);
    expect(await db.getWalletBalance('wallet_002')).toBe(destBefore);
  });

  test('multiple sequential transfers maintain correct running balances', async ({ api, db }) => {
    const balanceBefore = await db.getWalletBalance('wallet_001');

    await api.createTransfer(validTransfer({ amount: 100 }));
    await api.createTransfer(validTransfer({ amount: 200 }));
    await api.createTransfer(validTransfer({ amount: 300 }));

    const balanceAfter = await db.getWalletBalance('wallet_001');
    expect(balanceBefore - balanceAfter).toBe(600);
  });

  test('transfer GET reflects same state as POST response', async ({ api }) => {
    const payload = validTransfer({ amount: 750 });
    const createRes = await api.createTransfer(payload);
    const created = await createRes.json();

    const getRes = await api.getTransfer(created.transfer_id);
    const fetched = await getRes.json();

    expect(fetched.transfer_id).toBe(created.transfer_id);
    expect(fetched.status).toBe(created.status);
    expect(fetched.amount).toBe(created.amount);
    expect(fetched.source_wallet_id).toBe(created.source_wallet_id);
    expect(fetched.destination_wallet_id).toBe(created.destination_wallet_id);
  });

});
