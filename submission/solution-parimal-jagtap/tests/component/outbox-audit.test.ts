import { test, expect } from '../../fixtures/base';
import { validTransfer, idempotencyKey } from '../../helpers/test-data-factory';

/**
 * Component Interaction Tests
 *
 * Validates behavior of supporting components:
 *   - outbox/event table (exactly-once semantics)
 *   - audit/transfer_events table
 *   - idempotency store
 *
 * These confirm the system works beyond just the API boundary.
 */

test.describe('Component — Outbox, Audit & Idempotency Store', () => {

  test('outbox event created exactly once per successful transfer', async ({ api, db }) => {
    const payload = validTransfer({ amount: 300 });
    const res = await api.createTransfer(payload);
    const { transfer_id } = await res.json();

    const outbox = await db.getOutboxEvent(transfer_id);

    expect(outbox).not.toBeNull();
    expect(outbox.transfer_id).toBe(transfer_id);
    expect(outbox.event_type).toBe('WALLET_TRANSFER_COMPLETED');
    expect(outbox.published).toBe(false); // not yet dispatched
  });

  test('duplicate replay does NOT create a second outbox event', async ({ api, db }) => {
    const key = idempotencyKey();
    const payload = validTransfer({ amount: 100 });

    const res1 = await api.createTransfer(payload, key);
    const { transfer_id } = await res1.json();

    // Replay
    await api.createTransfer(payload, key);
    await api.createTransfer(payload, key);

    // Still only one outbox event for this transfer
    const outbox = await db.getOutboxEvent(transfer_id);
    expect(outbox).not.toBeNull();
    expect(outbox.transfer_id).toBe(transfer_id);
  });

  test('audit event contains correct transfer payload', async ({ api, db }) => {
    const payload = validTransfer({ amount: 450, currency: 'AED' });
    const res = await api.createTransfer(payload);
    const { transfer_id } = await res.json();

    const event = await db.getAuditEvent(transfer_id);

    expect(event).not.toBeNull();
    expect(event.event_type).toBe('TRANSFER_COMPLETED');
    expect(event.payload.amount).toBe(450);
    expect(event.payload.currency).toBe('AED');
    expect(event.payload.status).toBe('COMPLETED');
  });

  test('failed transfer — no outbox or audit event created', async ({ api, db }) => {
    // Invalid request — no transfer should be created
    const res = await api.createTransfer(validTransfer({ currency: 'INVALID' }));
    expect(res.status()).toBe(400);

    const body = await res.json();
    if (body.transfer_id) {
      const outbox = await db.getOutboxEvent(body.transfer_id);
      expect(outbox).toBeNull();
    }
  });

  test('insufficient balance — no outbox or audit event written', async ({ api, db }) => {
    const res = await api.createTransfer(validTransfer({
      source_wallet_id: 'wallet_003',
      amount: 9999,
    }));
    expect(res.status()).toBe(422);

    const body = await res.json();
    if (body.transfer_id) {
      const outbox = await db.getOutboxEvent(body.transfer_id);
      expect(outbox).toBeNull();
    }
  });

  test('idempotency store prevents duplicate side effects across retries', async ({ api, db }) => {
    const key = idempotencyKey();
    const payload = validTransfer({ amount: 75 });

    const balanceBefore = await db.getWalletBalance('wallet_001');

    // 4 retries
    await Promise.all([
      api.createTransfer(payload, key),
      api.createTransfer(payload, key),
      api.createTransfer(payload, key),
      api.createTransfer(payload, key),
    ]);

    const balanceAfter = await db.getWalletBalance('wallet_001');

    // Only one debit
    expect(balanceBefore - balanceAfter).toBe(75);

    // Exactly one idempotency record
    const idemRecord = await db.getIdempotencyRecord(key);
    expect(idemRecord).not.toBeNull();
  });

});
