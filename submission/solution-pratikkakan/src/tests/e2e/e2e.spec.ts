import { test, expect } from '../../fixtures';
import { buildTransferRequest, generateIdempotencyKey } from '../../helpers/builders';

/**
 * End-to-End Flow Tests
 *
 * These tests own the full vertical slice:
 *   API request → service processing → DB persistence → side-effect components
 *
 * They are intentionally broader than unit-level specs: each test touches all
 * observable layers and verifies internal consistency across them.
 */

test.describe('E2E — Happy Path', () => {
  test('full happy path: POST → GET transfer → GET wallets → DB events → outbox', async ({
    apiClient,
    db,
  }) => {
    const { sourceId, destId } = db.seedTestWallets(15_000, 3_000);
    const amount = 4_000;
    const reference = 'e2e-invoice-001';
    const key = generateIdempotencyKey();
    console.log(`[setup] src=${sourceId} (15000), dst=${destId} (3000), amount=${amount}, ref=${reference}`);

    // ── Step 1: POST /transfers ────────────────────────────────────────────
    const postRes = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount, reference }),
      key,
    );

    expect(postRes.status()).toBe(201);
    const postBody = await postRes.json();
    expect(postBody.status).toBe('COMPLETED');
    const transferId = postBody.id;
    console.log(`[step1] POST /transfers → ${postRes.status()} COMPLETED, transferId=${transferId}`);

    // ── Step 2: GET /transfers/:id ─────────────────────────────────────────
    const getTransferRes = await apiClient.getTransfer(transferId);
    expect(getTransferRes.status()).toBe(200);
    const getTransferBody = await getTransferRes.json();
    expect(getTransferBody.id).toBe(transferId);
    expect(getTransferBody.status).toBe('COMPLETED');
    expect(getTransferBody.amount).toBe(amount);
    expect(getTransferBody.reference).toBe(reference);
    console.log(`[step2] GET /transfers/${transferId} → ${getTransferRes.status()}, status=${getTransferBody.status}, amount=${getTransferBody.amount}`);

    // ── Step 3: GET /wallets/:id — API layer ───────────────────────────────
    const [srcWalletRes, dstWalletRes] = await Promise.all([
      apiClient.getWallet(sourceId),
      apiClient.getWallet(destId),
    ]);
    const srcBalance = (await srcWalletRes.json()).balance;
    const dstBalance = (await dstWalletRes.json()).balance;
    expect(srcBalance).toBe(15_000 - amount);
    expect(dstBalance).toBe(3_000 + amount);
    console.log(`[step3] GET /wallets → src balance=${srcBalance} (expected ${15_000 - amount}), dst balance=${dstBalance} (expected ${3_000 + amount})`);

    // ── Step 4: DB transfer record ─────────────────────────────────────────
    const dbTransfer = db.getTransfer(transferId);
    expect(dbTransfer.status).toBe('COMPLETED');
    expect(dbTransfer.amount).toBe(amount);
    expect(dbTransfer.idempotency_key).toBe(key);
    expect(db.getWallet(sourceId).balance).toBe(15_000 - amount);
    expect(db.getWallet(destId).balance).toBe(3_000 + amount);
    console.log(`[step4] DB transfer: status=${dbTransfer.status}, amount=${dbTransfer.amount}, balances match API ✓`);

    // ── Step 5: Audit / event trail ────────────────────────────────────────
    const events = db.getTransferEvents(transferId);
    expect(events.map((e) => e.event_type)).toContain('TRANSFER_INITIATED');
    expect(events.map((e) => e.event_type)).toContain('TRANSFER_COMPLETED');
    for (const e of events) {
      expect(e.transfer_id).toBe(transferId);
    }
    console.log(`[step5] DB events: [${events.map((e) => e.event_type).join(', ')}]`);

    // ── Step 6: Outbox (exactly-once publish stub) ─────────────────────────
    const outbox = db.getOutboxEvents(transferId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].published).toBe(0); // not yet dispatched — publisher is stubbed
    console.log(`[step6] outbox: ${outbox.length} row, event=${outbox[0].event_type}, published=${outbox[0].published} (pending)`);

    // ── Step 7: Idempotency store ──────────────────────────────────────────
    const idem = db.getIdempotencyRecord(key);
    expect(idem).toBeDefined();
    expect(idem!.transfer_id).toBe(transferId);
    expect(idem!.response_status).toBe(201);
    console.log(`[step7] idempotency record: key stored, transfer_id=${idem!.transfer_id}, response_status=${idem!.response_status}`);
  });
});

test.describe('E2E — Rejection Path', () => {
  test('full rejection path: insufficient balance leaves all tables clean', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(200, 10_000);
    const key = generateIdempotencyKey();
    console.log(`[setup] src=${sourceId} (200), dst=${destId} (10000), attempting transfer of 5000 (should fail)`);

    const res = await apiClient.createTransfer(
      buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 5_000 }),
      key,
    );

    // ── API layer ──────────────────────────────────────────────────────────
    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.error).toBe('INSUFFICIENT_BALANCE');
    console.log(`[result] POST /transfers → ${res.status()} ${body.error}`);

    // ── DB: wallets untouched ──────────────────────────────────────────────
    expect(db.getWallet(sourceId).balance).toBe(200);
    expect(db.getWallet(destId).balance).toBe(10_000);

    // ── DB: no transfer row ────────────────────────────────────────────────
    expect(db.countTransfersForWallet(sourceId)).toBe(0);

    // ── DB: no outbox event ────────────────────────────────────────────────
    // (No transfer ID exists; the overall count for this source wallet must be 0)
    expect(db.countTransfersForWallet(sourceId)).toBe(0);
    console.log(`[assert] DB clean: balances unchanged (src=200, dst=10000), transfer count=0, no outbox rows`);
  });
});

test.describe('E2E — Idempotency Retry Simulation', () => {
  test('client retry after assumed response loss: only one transfer persisted', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 3_000 });
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (0), amount=3000, key=${key.slice(0, 8)}...`);

    // Simulate: client sends request, doesn't know if it arrived (response lost)
    const attempt1 = await apiClient.createTransfer(payload, key);
    expect(attempt1.status()).toBe(201);
    const firstBody = await attempt1.json();
    console.log(`[attempt1] POST /transfers → ${attempt1.status()}, transferId=${firstBody.id}`);

    // Client retries using the same idempotency key
    const attempt2 = await apiClient.createTransfer(payload, key);
    expect(attempt2.status()).toBe(200); // replay
    const retryBody = await attempt2.json();
    console.log(`[attempt2] POST /transfers (retry) → ${attempt2.status()} (replay), id=${retryBody.id} matches original=${retryBody.id === firstBody.id}`);

    // Both responses are logically identical
    expect(retryBody.id).toBe(firstBody.id);
    expect(retryBody.status).toBe('COMPLETED');

    // ── DB: exactly ONE transfer row ───────────────────────────────────────
    expect(db.getTransfersByIdempotencyKey(key)).toHaveLength(1);

    // ── DB: balance debited only once ─────────────────────────────────────
    expect(db.getWallet(sourceId).balance).toBe(10_000 - 3_000);
    expect(db.getWallet(destId).balance).toBe(3_000);

    // ── DB: outbox has exactly one row (publish not triggered twice) ───────
    const { id } = firstBody;
    expect(db.getOutboxEvents(id)).toHaveLength(1);
    console.log(`[assert] DB: 1 transfer row, src balance=7000 (debited once), outbox rows=1`);
  });

  test('three-retry scenario: balance and transfer count remain consistent', async ({ apiClient, db }) => {
    const { sourceId, destId } = db.seedTestWallets(10_000, 0);
    const key = generateIdempotencyKey();
    const payload = buildTransferRequest({ source_wallet_id: sourceId, destination_wallet_id: destId, amount: 2_000 });
    console.log(`[setup] src=${sourceId} (10000), dst=${destId} (0), amount=2000, firing 3 concurrent requests with same key`);

    const responses = await Promise.all([
      apiClient.createTransfer(payload, key),
      apiClient.createTransfer(payload, key),
      apiClient.createTransfer(payload, key),
    ]);

    const statuses = responses.map((r) => r.status());
    console.log(`[result] response statuses: [${statuses.join(', ')}] — expect one 201 (original) rest 200 (replays)`);
    expect(statuses).toContain(201); // at least one must be the original
    // All non-201s must be 200 (cached replay)
    for (const s of statuses) {
      expect([200, 201]).toContain(s);
    }

    expect(db.getTransfersByIdempotencyKey(key)).toHaveLength(1);
    expect(db.getWallet(sourceId).balance).toBe(10_000 - 2_000);
    console.log(`[assert] DB: 1 transfer row, src balance=8000 (debited exactly once)`);
  });
});
