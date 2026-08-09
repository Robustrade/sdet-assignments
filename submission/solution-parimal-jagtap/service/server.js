/**
 * Wallet Transfer Service — Minimal Test Fixture
 *
 * This is a lightweight in-memory service built specifically
 * to make the test suite runnable without an external system.
 *
 * It implements the exact API contract from the assignment:
 *   POST /transfers
 *   GET  /transfers/:transfer_id
 *   GET  /wallets/:wallet_id
 *
 * Database is simulated in-memory using Maps.
 * All business rules from the assignment are enforced.
 */

const http = require('http');

// ─── In-Memory Database ───────────────────────────────────────────────────────

const db = {
  wallets: new Map(),
  transfers: new Map(),
  idempotency_keys: new Map(),
  transfer_events: new Map(),   // audit log
  outbox_events: new Map(),     // downstream events
};

// ─── Seed Wallets ─────────────────────────────────────────────────────────────

function seedWallets() {
  db.wallets.set('wallet_001', { wallet_id: 'wallet_001', balance: 10000, currency: 'AED', created_at: new Date().toISOString() });
  db.wallets.set('wallet_002', { wallet_id: 'wallet_002', balance: 5000,  currency: 'AED', created_at: new Date().toISOString() });
  db.wallets.set('wallet_003', { wallet_id: 'wallet_003', balance: 0,     currency: 'AED', created_at: new Date().toISOString() });
}

function resetDB() {
  db.wallets.clear();
  db.transfers.clear();
  db.idempotency_keys.clear();
  db.transfer_events.clear();
  db.outbox_events.clear();
  seedWallets();
}

resetDB();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid() {
  return 'txn_' + Math.random().toString(36).substr(2, 12) + '_' + Date.now();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Business Logic ───────────────────────────────────────────────────────────

function validateTransferRequest(body, idempotencyKey) {
  const errors = [];

  if (!body.source_wallet_id)      errors.push({ field: 'source_wallet_id', message: 'required' });
  if (!body.destination_wallet_id) errors.push({ field: 'destination_wallet_id', message: 'required' });
  if (!body.amount)                errors.push({ field: 'amount', message: 'required' });
  if (!body.currency)              errors.push({ field: 'currency', message: 'required' });
  if (!body.reference)             errors.push({ field: 'reference', message: 'required' });

  if (body.amount !== undefined && (typeof body.amount !== 'number' || body.amount <= 0)) {
    errors.push({ field: 'amount', message: 'must be a positive number' });
  }

  const validCurrencies = ['AED', 'USD', 'EUR', 'INR', 'GBP'];
  if (body.currency && !validCurrencies.includes(body.currency)) {
    errors.push({ field: 'currency', message: `unsupported currency: ${body.currency}` });
  }

  if (body.source_wallet_id && body.destination_wallet_id &&
      body.source_wallet_id === body.destination_wallet_id) {
    errors.push({ field: 'destination_wallet_id', message: 'source and destination wallets must be different' });
  }

  return errors;
}

// Mutex map to prevent race conditions on same wallet
const walletLocks = new Map();

async function acquireLock(walletId) {
  while (walletLocks.get(walletId)) {
    await new Promise(r => setTimeout(r, 5));
  }
  walletLocks.set(walletId, true);
}

function releaseLock(walletId) {
  walletLocks.delete(walletId);
}

async function processTransfer(body, idempotencyKey) {
  const lockKey = [body.source_wallet_id, body.destination_wallet_id].sort().join(':');
  await acquireLock(lockKey);

  try {
    const sourceWallet = db.wallets.get(body.source_wallet_id);
    const destWallet   = db.wallets.get(body.destination_wallet_id);

    if (!sourceWallet) return { status: 404, body: { error: 'source wallet not found' } };
    if (!destWallet)   return { status: 404, body: { error: 'destination wallet not found' } };

    if (sourceWallet.balance < body.amount) {
      return {
        status: 422,
        body: {
          error: 'insufficient_balance',
          message: 'Source wallet has insufficient balance',
          available: sourceWallet.balance,
          required: body.amount
        }
      };
    }

    // Debit source, credit destination atomically
    sourceWallet.balance -= body.amount;
    destWallet.balance   += body.amount;

    const transferId = uuid();
    const now = new Date().toISOString();

    const transfer = {
      transfer_id: transferId,
      source_wallet_id: body.source_wallet_id,
      destination_wallet_id: body.destination_wallet_id,
      amount: body.amount,
      currency: body.currency,
      reference: body.reference,
      status: 'COMPLETED',
      idempotency_key: idempotencyKey || null,
      created_at: now,
      updated_at: now,
    };

    db.transfers.set(transferId, transfer);

    // Store idempotency record
    if (idempotencyKey) {
      db.idempotency_keys.set(idempotencyKey, {
        key: idempotencyKey,
        transfer_id: transferId,
        request_hash: JSON.stringify(body),
        created_at: now,
      });
    }

    // Write audit event
    db.transfer_events.set(transferId, {
      event_id: 'evt_' + transferId,
      transfer_id: transferId,
      event_type: 'TRANSFER_COMPLETED',
      payload: { ...transfer },
      created_at: now,
    });

    // Write outbox event (exactly once)
    db.outbox_events.set(transferId, {
      outbox_id: 'out_' + transferId,
      transfer_id: transferId,
      event_type: 'WALLET_TRANSFER_COMPLETED',
      published: false,
      created_at: now,
    });

    return { status: 201, body: transfer };

  } finally {
    releaseLock(lockKey);
  }
}

// ─── Route Handler ────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  try {

    // POST /transfers
    if (method === 'POST' && url === '/transfers') {
      const body = await parseBody(req);
      const idempotencyKey = req.headers['idempotency-key'] || null;

      // Idempotency check — return original result if key already seen
      if (idempotencyKey && db.idempotency_keys.has(idempotencyKey)) {
        const existing = db.idempotency_keys.get(idempotencyKey);

        // Same key + different payload = reject
        if (existing.request_hash !== JSON.stringify(body)) {
          return send(res, 422, {
            error: 'idempotency_conflict',
            message: 'Idempotency key already used with a different request payload'
          });
        }

        // Same key + same payload = return original transfer
        const originalTransfer = db.transfers.get(existing.transfer_id);
        return send(res, 200, originalTransfer);
      }

      // Validate request
      const errors = validateTransferRequest(body, idempotencyKey);
      if (errors.length > 0) {
        return send(res, 400, { error: 'validation_failed', errors });
      }

      const result = await processTransfer(body, idempotencyKey);
      return send(res, result.status, result.body);
    }

    // GET /transfers/:transfer_id
    const transferMatch = url.match(/^\/transfers\/([^/]+)$/);
    if (method === 'GET' && transferMatch) {
      const transfer = db.transfers.get(transferMatch[1]);
      if (!transfer) return send(res, 404, { error: 'transfer not found' });
      return send(res, 200, transfer);
    }

    // GET /wallets/:wallet_id
    const walletMatch = url.match(/^\/wallets\/([^/]+)$/);
    if (method === 'GET' && walletMatch) {
      const wallet = db.wallets.get(walletMatch[1]);
      if (!wallet) return send(res, 404, { error: 'wallet not found' });
      return send(res, 200, wallet);
    }

    // Test-only endpoints for DB assertions
    if (method === 'GET' && url === '/test/db/wallets') {
      return send(res, 200, Object.fromEntries(db.wallets));
    }

    if (method === 'GET' && url.startsWith('/test/db/transfers/')) {
      const id = url.replace('/test/db/transfers/', '');
      const record = db.transfers.get(id);
      if (!record) return send(res, 404, { error: 'not found' });
      return send(res, 200, record);
    }

    if (method === 'GET' && url.startsWith('/test/db/idempotency/')) {
      const key = url.replace('/test/db/idempotency/', '');
      const record = db.idempotency_keys.get(decodeURIComponent(key));
      if (!record) return send(res, 404, { error: 'not found' });
      return send(res, 200, record);
    }

    if (method === 'GET' && url.startsWith('/test/db/events/')) {
      const id = url.replace('/test/db/events/', '');
      const record = db.transfer_events.get(id);
      if (!record) return send(res, 404, { error: 'not found' });
      return send(res, 200, record);
    }

    if (method === 'GET' && url.startsWith('/test/db/outbox/')) {
      const id = url.replace('/test/db/outbox/', '');
      const record = db.outbox_events.get(id);
      if (!record) return send(res, 404, { error: 'not found' });
      return send(res, 200, record);
    }

    if (method === 'POST' && url === '/test/reset') {
      resetDB();
      return send(res, 200, { message: 'database reset' });
    }

    send(res, 404, { error: 'not found' });

  } catch (err) {
    send(res, 500, { error: 'internal server error', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Wallet Transfer Service running on port ${PORT}`);
  console.log('Seeded wallets: wallet_001 (10000 AED), wallet_002 (5000 AED), wallet_003 (0 AED)');
});

module.exports = { server, db, resetDB };
