const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const DatabaseHelper = require('../../utils/databaseHelper');

const app = express();
const dbHelper = new DatabaseHelper();

// Initialize database
(async () => {
  await dbHelper.initialize();
  console.log('Database initialized');
})();

app.use(express.json());

const idempotencyCache = new Map();

function calculateRequestHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

async function checkIdempotency(idempotencyKey, requestHash) {
  if (idempotencyCache.has(idempotencyKey)) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached.requestHash !== requestHash) {
      return { conflict: true };
    }
    return { cached: true, response: cached.response };
  }

  const record = await dbHelper.getIdempotencyRecord(idempotencyKey);
  if (record) {
    if (record.request_hash !== requestHash) {
      return { conflict: true };
    }
    return { cached: true, response: JSON.parse(record.response_body) };
  }

  return { cached: false };
}

async function storeIdempotencyRecord(idempotencyKey, requestHash, status, responseBody) {
  const query = `
    INSERT INTO idempotency_keys (idempotency_key, request_hash, response_status, response_body, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `;
  try {
    await dbHelper.initialize();
    dbHelper.db.run(query, [idempotencyKey, requestHash, status, JSON.stringify(responseBody)]);
  } catch (error) {
    // Ignore duplicate key errors
  }
  
  idempotencyCache.set(idempotencyKey, {
    requestHash,
    response: responseBody,
  });
}

app.post('/transfers', async (req, res) => {
  try {
    const { source_wallet_id, destination_wallet_id, amount, currency, reference } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];

    if (!source_wallet_id) {
      return res.status(400).json({ error: 'source_wallet_id is required' });
    }

    if (!destination_wallet_id) {
      return res.status(400).json({ error: 'destination_wallet_id is required' });
    }

    if (amount === undefined || amount === null) {
      return res.status(400).json({ error: 'amount is required' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'amount must be greater than zero' });
    }

    if (amount < 0) {
      return res.status(400).json({ error: 'negative amount is not allowed' });
    }

    if (!currency) {
      return res.status(400).json({ error: 'currency is required' });
    }

    const validCurrencies = ['AED', 'USD', 'EUR', 'GBP'];
    if (!validCurrencies.includes(currency)) {
      return res.status(400).json({ error: 'invalid currency' });
    }

    if (source_wallet_id === destination_wallet_id) {
      return res.status(400).json({ error: 'source and destination wallets must be different' });
    }

    if (idempotencyKey) {
      const requestHash = calculateRequestHash(req.body);
      const idempotencyCheck = await checkIdempotency(idempotencyKey, requestHash);

      if (idempotencyCheck.conflict) {
        return res.status(409).json({ error: 'idempotency key conflict: payload mismatch' });
      }

      if (idempotencyCheck.cached) {
        return res.status(201).json(idempotencyCheck.response);
      }
    }

    const sourceWallet = await dbHelper.getWallet(source_wallet_id);
    if (!sourceWallet) {
      return res.status(404).json({ error: 'source wallet not found' });
    }

    const destWallet = await dbHelper.getWallet(destination_wallet_id);
    if (!destWallet) {
      return res.status(404).json({ error: 'destination wallet not found' });
    }

    if (parseFloat(sourceWallet.balance) < amount) {
      const errorResponse = { error: 'insufficient balance' };
      if (idempotencyKey) {
        await storeIdempotencyRecord(idempotencyKey, calculateRequestHash(req.body), 422, errorResponse);
      }
      return res.status(422).json(errorResponse);
    }

    const transferId = `transfer_${uuidv4().substring(0, 8)}`;

    try {
      // SQLite transaction
      await dbHelper.initialize();
      dbHelper.db.run('BEGIN');

      dbHelper.db.run(
        "UPDATE wallets SET balance = balance - ?, updated_at = datetime('now') WHERE wallet_id = ?",
        [amount, source_wallet_id]
      );

      dbHelper.db.run(
        "UPDATE wallets SET balance = balance + ?, updated_at = datetime('now') WHERE wallet_id = ?",
        [amount, destination_wallet_id]
      );

      dbHelper.db.run(
        `INSERT INTO transfers (transfer_id, source_wallet_id, destination_wallet_id, amount, currency, reference, status, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [transferId, source_wallet_id, destination_wallet_id, amount, currency, reference, 'completed', idempotencyKey]
      );

      dbHelper.db.run(
        `INSERT INTO transfer_events (transfer_id, event_type, created_at)
         VALUES (?, ?, datetime('now'))`,
        [transferId, 'transfer_initiated']
      );

      dbHelper.db.run(
        `INSERT INTO transfer_events (transfer_id, event_type, created_at)
         VALUES (?, ?, datetime('now'))`,
        [transferId, 'transfer_completed']
      );

      const outboxPayload = {
        transfer_id: transferId,
        source_wallet_id,
        destination_wallet_id,
        amount,
        currency,
      };

      dbHelper.db.run(
        `INSERT INTO outbox_events (aggregate_id, event_type, payload, processed, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [transferId, 'TransferCompleted', JSON.stringify(outboxPayload), 0]
      );

      dbHelper.db.run(
        `INSERT INTO audit_logs (entity_type, entity_id, action, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        ['transfer', transferId, 'CREATE']
      );

      dbHelper.db.run('COMMIT');

      const responseBody = {
        transfer_id: transferId,
        source_wallet_id,
        destination_wallet_id,
        amount,
        currency,
        reference,
        status: 'completed',
      };

      if (idempotencyKey) {
        await storeIdempotencyRecord(idempotencyKey, calculateRequestHash(req.body), 201, responseBody);
      }

      return res.status(201).json(responseBody);
    } catch (error) {
      dbHelper.db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Transfer error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/transfers/:transferId', async (req, res) => {
  try {
    const { transferId } = req.params;
    const transfer = await dbHelper.getTransfer(transferId);

    if (!transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    return res.status(200).json({
      transfer_id: transfer.transfer_id,
      source_wallet_id: transfer.source_wallet_id,
      destination_wallet_id: transfer.destination_wallet_id,
      amount: parseFloat(transfer.amount),
      currency: transfer.currency,
      reference: transfer.reference,
      status: transfer.status,
      created_at: transfer.created_at,
      updated_at: transfer.updated_at,
    });
  } catch (error) {
    console.error('Get transfer error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/wallets/:walletId', async (req, res) => {
  try {
    const { walletId } = req.params;
    const wallet = await dbHelper.getWallet(walletId);

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    return res.status(200).json({
      wallet_id: wallet.wallet_id,
      balance: parseFloat(wallet.balance),
      currency: wallet.currency,
      created_at: wallet.created_at,
      updated_at: wallet.updated_at,
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/wallets', async (req, res) => {
  try {
    const { wallet_id, balance = 0, currency = 'AED' } = req.body;

    if (!wallet_id) {
      return res.status(400).json({ error: 'wallet_id is required' });
    }

    const wallet = await dbHelper.createWallet(wallet_id, balance, currency);

    return res.status(201).json({
      wallet_id: wallet.wallet_id,
      balance: parseFloat(wallet.balance),
      currency: wallet.currency,
    });
  } catch (error) {
    console.error('Create wallet error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Wallet Transfer Service running on port ${PORT}`);
  });
}

module.exports = app;
