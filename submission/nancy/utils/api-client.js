// utils/api-client.js
/**
 * Thin wrapper around Playwright's APIRequestContext.
 * Keeps transport details out of test logic.
 */

const BASE = 'http://localhost:3001';

async function post(request, path, body, headers = {}) {
  return request.post(`${BASE}${path}`, {
    data: body,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function get(request, path) {
  return request.get(`${BASE}${path}`);
}

async function del(request, path) {
  return request.delete(`${BASE}${path}`);
}

// ── Wallet helpers ─────────────────────────────────────────────────────────────
async function createWallet(request, id, balance = 10000, currency = 'AED') {
  const res = await post(request, '/wallets', { id, balance, currency });
  return res;
}

async function getWallet(request, id) {
  const res = await get(request, `/wallets/${id}`);
  return res;
}

// ── Transfer helpers ───────────────────────────────────────────────────────────
async function createTransfer(request, payload, idempotencyKey = null) {
  const headers = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return post(request, '/transfers', payload, headers);
}

async function getTransfer(request, id) {
  return get(request, `/transfers/${id}`);
}

// ── DB inspection helpers (test-only endpoints) ────────────────────────────────
async function dbWallets(request)          { return (await (await get(request, '/test/db/wallets')).json()); }
async function dbTransfers(request)        { return (await (await get(request, '/test/db/transfers')).json()); }
async function dbIdempotencyKeys(request)  { return (await (await get(request, '/test/db/idempotency_keys')).json()); }
async function dbTransferEvents(request)   { return (await (await get(request, '/test/db/transfer_events')).json()); }
async function dbOutboxEvents(request)     { return (await (await get(request, '/test/db/outbox_events')).json()); }

async function resetDB(request) {
  return del(request, '/test/reset');
}

module.exports = {
  createWallet, getWallet,
  createTransfer, getTransfer,
  dbWallets, dbTransfers, dbIdempotencyKeys, dbTransferEvents, dbOutboxEvents,
  resetDB,
};
