/**
 * Wallet Transfer Service — Minimal Fixture
 * Uses in-memory JS Map/Objects (no native deps) for Windows compatibility.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3001;
const app = express();
app.use(express.json());

// ─── IN-MEMORY STORE ──────────────────────────────────────────────────────────
let db = {
  wallets:          {},   // id -> { id, balance, currency }
  transfers:        {},   // id -> transfer
  idempotency_keys: {},   // key -> { key, transfer_id, request_hash }
  transfer_events:  [],   // [{ id, transfer_id, event_type, payload, created_at }]
  outbox_events:    [],   // [{ id, transfer_id, event_type, published, created_at }]
};

function resetStore() {
  db = { wallets: {}, transfers: {}, idempotency_keys: {}, transfer_events: [], outbox_events: [] };
}

function now() { return new Date().toISOString(); }

function hashRequest(body) {
  return Buffer.from(JSON.stringify({
    source_wallet_id:      body.source_wallet_id,
    destination_wallet_id: body.destination_wallet_id,
    amount:                body.amount,
    currency:              body.currency,
    reference:             body.reference ?? null,
  })).toString('base64');
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Create wallet
app.post('/wallets', (req, res) => {
  const { id, balance = 0, currency = 'AED' } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  if (db.wallets[id]) return res.status(409).json({ error: 'Wallet already exists' });
  db.wallets[id] = { id, balance, currency };
  res.status(201).json(db.wallets[id]);
});

// Get wallet
app.get('/wallets/:id', (req, res) => {
  const w = db.wallets[req.params.id];
  if (!w) return res.status(404).json({ error: 'Wallet not found' });
  res.json(w);
});

// POST /transfers
app.post('/transfers', (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  const { source_wallet_id, destination_wallet_id, amount, currency, reference } = req.body;

  // Validation
  if (!source_wallet_id || !destination_wallet_id || amount === undefined || amount === null || !currency)
    return res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
  if (typeof amount !== 'number' || amount <= 0)
    return res.status(400).json({ error: 'amount must be a positive number', code: 'VALIDATION_ERROR' });
  if (!Number.isInteger(amount))
    return res.status(400).json({ error: 'amount must be an integer', code: 'VALIDATION_ERROR' });
  if (source_wallet_id === destination_wallet_id)
    return res.status(400).json({ error: 'source and destination wallets must differ', code: 'VALIDATION_ERROR' });
  if (!['AED', 'USD', 'EUR', 'GBP'].includes(currency))
    return res.status(400).json({ error: `Unsupported currency: ${currency}`, code: 'INVALID_CURRENCY' });

  // Idempotency check
  if (idempotencyKey) {
    const existing = db.idempotency_keys[idempotencyKey];
    if (existing) {
      if (existing.request_hash !== hashRequest(req.body))
        return res.status(409).json({ error: 'Idempotency key reused with different payload', code: 'IDEMPOTENCY_CONFLICT' });
      return res.status(200).json(db.transfers[existing.transfer_id]);
    }
  }

  const src = db.wallets[source_wallet_id];
  const dst = db.wallets[destination_wallet_id];

  if (!src) return res.status(404).json({ error: 'Source wallet not found', code: 'WALLET_NOT_FOUND' });
  if (!dst) return res.status(404).json({ error: 'Destination wallet not found', code: 'WALLET_NOT_FOUND' });
  if (src.currency !== currency || dst.currency !== currency)
    return res.status(400).json({ error: 'Currency mismatch', code: 'CURRENCY_MISMATCH' });
  if (src.balance < amount)
    return res.status(422).json({ error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' });

  // Atomic-style execute (single-threaded JS, no races within one event loop tick)
  const transferId = uuidv4();
  const ts = now();

  src.balance -= amount;
  dst.balance += amount;

  const transfer = {
    id: transferId,
    source_wallet_id,
    destination_wallet_id,
    amount,
    currency,
    reference: reference ?? null,
    status: 'COMPLETED',
    idempotency_key: idempotencyKey ?? null,
    created_at: ts,
    updated_at: ts,
  };
  db.transfers[transferId] = transfer;

  if (idempotencyKey) {
    db.idempotency_keys[idempotencyKey] = {
      key: idempotencyKey,
      transfer_id: transferId,
      request_hash: hashRequest(req.body),
      created_at: ts,
    };
  }

  db.transfer_events.push({ id: uuidv4(), transfer_id: transferId, event_type: 'TRANSFER_COMPLETED', payload: JSON.stringify({ amount, currency }), created_at: ts });
  db.outbox_events.push({ id: uuidv4(), transfer_id: transferId, event_type: 'TRANSFER_COMPLETED', published: 0, created_at: ts });

  res.status(201).json(transfer);
});

// GET /transfers/:id
app.get('/transfers/:id', (req, res) => {
  const t = db.transfers[req.params.id];
  if (!t) return res.status(404).json({ error: 'Transfer not found' });
  res.json(t);
});

// ─── TEST HELPERS ─────────────────────────────────────────────────────────────
app.delete('/test/reset', (_req, res) => { resetStore(); res.json({ reset: true }); });
app.get('/test/db/wallets',         (_req, res) => res.json(Object.values(db.wallets)));
app.get('/test/db/transfers',       (_req, res) => res.json(Object.values(db.transfers)));
app.get('/test/db/idempotency_keys',(_req, res) => res.json(Object.values(db.idempotency_keys)));
app.get('/test/db/transfer_events', (_req, res) => res.json(db.transfer_events));
app.get('/test/db/outbox_events',   (_req, res) => res.json(db.outbox_events));

// ─── BOOT ─────────────────────────────────────────────────────────────────────
function start(port = PORT) {
  return app.listen(port, () => console.log(`Wallet service running on :${port}`));
}

module.exports = { app, start };
if (require.main === module) start();
