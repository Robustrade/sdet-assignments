// utils/data-builders.js
const { v4: uuidv4 } = require('uuid');

function buildTransferPayload(overrides = {}) {
  return {
    source_wallet_id:      'wallet_src',
    destination_wallet_id: 'wallet_dst',
    amount:                2500,
    currency:              'AED',
    reference:             `invoice_${Date.now()}`,
    ...overrides,
  };
}

function newIdempotencyKey() {
  return uuidv4();
}

function walletId(prefix = 'w') {
  return `${prefix}_${uuidv4().slice(0, 8)}`;
}

module.exports = { buildTransferPayload, newIdempotencyKey, walletId };
