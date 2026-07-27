const initSqlJs = require('sql.js');
let SQL = null;

class DatabaseHelper {
  constructor(config = {}) {
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    if (!SQL) {
      SQL = await initSqlJs();
    }
    
    this.db = new SQL.Database();
    this.initializeSchema();
    this.initialized = true;
  }

  initializeSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS wallets (
        wallet_id TEXT PRIMARY KEY,
        balance REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'AED',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (balance >= 0)
      );

      CREATE TABLE IF NOT EXISTS transfers (
        transfer_id TEXT PRIMARY KEY,
        source_wallet_id TEXT NOT NULL,
        destination_wallet_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        reference TEXT,
        status TEXT NOT NULL,
        idempotency_key TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (amount > 0),
        CHECK (source_wallet_id != destination_wallet_id),
        FOREIGN KEY (source_wallet_id) REFERENCES wallets(wallet_id),
        FOREIGN KEY (destination_wallet_id) REFERENCES wallets(wallet_id)
      );

      CREATE INDEX IF NOT EXISTS idx_transfers_source_wallet ON transfers(source_wallet_id);
      CREATE INDEX IF NOT EXISTS idx_transfers_dest_wallet ON transfers(destination_wallet_id);
      CREATE INDEX IF NOT EXISTS idx_transfers_idempotency_key ON transfers(idempotency_key);

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        idempotency_key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS transfer_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        transfer_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transfer_id) REFERENCES transfers(transfer_id)
      );

      CREATE INDEX IF NOT EXISTS idx_transfer_events_transfer_id ON transfer_events(transfer_id);

      CREATE TABLE IF NOT EXISTS outbox_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0,
        processed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate_id ON outbox_events(aggregate_id);
      CREATE INDEX IF NOT EXISTS idx_outbox_events_processed ON outbox_events(processed);

      CREATE TABLE IF NOT EXISTS audit_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT,
        changes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
    `);
  }

  query(text, params = []) {
    try {
      const result = this.db.exec(text, params);
      if (text.trim().toUpperCase().startsWith('SELECT')) {
        if (result.length > 0) {
          const columns = result[0].columns;
          const values = result[0].values;
          const rows = values.map(row => {
            const obj = {};
            columns.forEach((col, idx) => {
              obj[col] = row[idx];
            });
            return obj;
          });
          return { rows };
        }
        return { rows: [] };
      } else {
        return { rows: [], rowCount: this.db.getRowsModified() };
      }
    } catch (error) {
      throw error;
    }
  }

  async getWallet(walletId) {
    await this.initialize();
    const query = 'SELECT * FROM wallets WHERE wallet_id = ?';
    const stmt = this.db.prepare(query);
    stmt.bind([walletId]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(row);
    }
    stmt.free();
    return rows[0] || null;
  }

  async getWalletBalance(walletId) {
    const wallet = await this.getWallet(walletId);
    return wallet ? wallet.balance : null;
  }

  async createWallet(walletId, balance = 0, currency = 'AED') {
    await this.initialize();
    const query = `
      INSERT INTO wallets (wallet_id, balance, currency, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `;
    this.db.run(query, [walletId, balance, currency]);
    return this.getWallet(walletId);
  }

  async updateWalletBalance(walletId, balance) {
    await this.initialize();
    const query = `
      UPDATE wallets 
      SET balance = ?, updated_at = datetime('now')
      WHERE wallet_id = ?
    `;
    this.db.run(query, [balance, walletId]);
    return this.getWallet(walletId);
  }

  async deleteWallet(walletId) {
    await this.initialize();
    const query = 'DELETE FROM wallets WHERE wallet_id = ?';
    this.db.run(query, [walletId]);
  }

  async getTransfer(transferId) {
    await this.initialize();
    const query = 'SELECT * FROM transfers WHERE transfer_id = ?';
    const stmt = this.db.prepare(query);
    stmt.bind([transferId]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows[0] || null;
  }

  async getTransfersByWallet(walletId) {
    await this.initialize();
    const query = `
      SELECT * FROM transfers 
      WHERE source_wallet_id = ? OR destination_wallet_id = ?
      ORDER BY created_at DESC
    `;
    const stmt = this.db.prepare(query);
    stmt.bind([walletId, walletId]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  async getTransfersByIdempotencyKey(idempotencyKey) {
    await this.initialize();
    const query = 'SELECT * FROM transfers WHERE idempotency_key = ?';
    const stmt = this.db.prepare(query);
    stmt.bind([idempotencyKey]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  async getIdempotencyRecord(idempotencyKey) {
    await this.initialize();
    const query = 'SELECT * FROM idempotency_keys WHERE idempotency_key = ?';
    const stmt = this.db.prepare(query);
    stmt.bind([idempotencyKey]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows[0] || null;
  }

  async getTransferEvents(transferId) {
    await this.initialize();
    const query = `
      SELECT * FROM transfer_events 
      WHERE transfer_id = ? 
      ORDER BY created_at ASC
    `;
    const stmt = this.db.prepare(query);
    stmt.bind([transferId]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  async getOutboxEvents(transferId) {
    await this.initialize();
    const query = `
      SELECT * FROM outbox_events 
      WHERE aggregate_id = ? 
      ORDER BY created_at ASC
    `;
    const stmt = this.db.prepare(query);
    stmt.bind([transferId]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  async getAuditLogs(entityType, entityId) {
    await this.initialize();
    const query = `
      SELECT * FROM audit_logs 
      WHERE entity_type = ? AND entity_id = ? 
      ORDER BY created_at ASC
    `;
    const stmt = this.db.prepare(query);
    stmt.bind([entityType, entityId]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  async cleanupTestData() {
    await this.initialize();
    const queries = [
      'DELETE FROM outbox_events',
      'DELETE FROM transfer_events',
      'DELETE FROM audit_logs',
      'DELETE FROM idempotency_keys',
      'DELETE FROM transfers',
      'DELETE FROM wallets',
    ];

    for (const query of queries) {
      try {
        this.db.run(query);
      } catch (error) {
        console.warn(`Warning: Failed to execute cleanup query: ${query}`, error.message);
      }
    }
  }

  async seedWallets(wallets) {
    const results = [];
    for (const wallet of wallets) {
      const result = await this.createWallet(
        wallet.wallet_id,
        wallet.balance || 0,
        wallet.currency || 'AED'
      );
      results.push(result);
    }
    return results;
  }

  async verifyBalanceConservation(sourceWalletId, destWalletId, initialSourceBalance, initialDestBalance, transferAmount) {
    const sourceWallet = await this.getWallet(sourceWalletId);
    const destWallet = await this.getWallet(destWalletId);

    const totalBefore = initialSourceBalance + initialDestBalance;
    const totalAfter = sourceWallet.balance + destWallet.balance;

    return {
      isConserved: totalBefore === totalAfter,
      totalBefore,
      totalAfter,
      sourceBalanceBefore: initialSourceBalance,
      sourceBalanceAfter: sourceWallet.balance,
      destBalanceBefore: initialDestBalance,
      destBalanceAfter: destWallet.balance,
      expectedSourceBalance: initialSourceBalance - transferAmount,
      expectedDestBalance: initialDestBalance + transferAmount,
    };
  }

  async verifyNoSideEffects(walletId, expectedBalance) {
    const wallet = await this.getWallet(walletId);
    return wallet.balance === expectedBalance;
  }

  async countTransfersByIdempotencyKey(idempotencyKey) {
    await this.initialize();
    const query = 'SELECT COUNT(*) as count FROM transfers WHERE idempotency_key = ?';
    const stmt = this.db.prepare(query);
    stmt.bind([idempotencyKey]);
    let count = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      count = parseInt(row.count, 10);
    }
    stmt.free();
    return count;
  }

  async countOutboxEventsByTransferId(transferId) {
    await this.initialize();
    const query = 'SELECT COUNT(*) as count FROM outbox_events WHERE aggregate_id = ?';
    const stmt = this.db.prepare(query);
    stmt.bind([transferId]);
    let count = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      count = parseInt(row.count, 10);
    }
    stmt.free();
    return count;
  }

  async close() {
    if (this.db) {
      this.db.close();
    }
  }

  async testConnection() {
    try {
      await this.initialize();
      const stmt = this.db.prepare('SELECT datetime("now") as now');
      let timestamp = null;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        timestamp = row.now;
      }
      stmt.free();
      return { success: true, timestamp };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = DatabaseHelper;
