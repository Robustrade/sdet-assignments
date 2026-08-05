import type Database from 'better-sqlite3';
import type { Wallet, Transfer, AuditEvent, OutboxEvent } from '../../src/service/types';

export class DbHelpers {
  constructor(private db: Database.Database) {}

  getWallet(walletId: string): Wallet | undefined {
    return this.db.prepare('SELECT id, balance, currency FROM wallets WHERE id = ?')
      .get(walletId) as Wallet | undefined;
  }

  getWalletBalance(walletId: string): number {
    const row = this.getWallet(walletId);
    if (!row) throw new Error(`Wallet ${walletId} not found`);
    return row.balance;
  }

  getTransfer(transferId: string): Transfer | undefined {
    return this.db.prepare(
      `SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
              reference, status, idempotency_key, payload_hash, created_at
       FROM transfers WHERE id = ?`
    ).get(transferId) as Transfer | undefined;
  }

  getTransferCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM transfers').get() as { count: number };
    return row.count;
  }

  getTransfersByIdempotencyKey(key: string): Transfer[] {
    return this.db.prepare(
      `SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
              reference, status, idempotency_key, payload_hash, created_at
       FROM transfers WHERE idempotency_key = ?`
    ).all(key) as Transfer[];
  }

  getAuditEvents(transferId: string): AuditEvent[] {
    return this.db.prepare(
      'SELECT id, transfer_id, event_type, payload, created_at FROM audit_events WHERE transfer_id = ?'
    ).all(transferId) as AuditEvent[];
  }

  getAuditEventCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM audit_events').get() as { count: number };
    return row.count;
  }

  getOutboxEvents(transferId: string): OutboxEvent[] {
    return this.db.prepare(
      'SELECT id, transfer_id, event_type, payload, status, created_at FROM outbox_events WHERE transfer_id = ?'
    ).all(transferId) as OutboxEvent[];
  }

  getOutboxEventCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM outbox_events').get() as { count: number };
    return row.count;
  }

  getAllTransfers(): Transfer[] {
    return this.db.prepare(
      `SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
              reference, status, idempotency_key, payload_hash, created_at
       FROM transfers`
    ).all() as Transfer[];
  }

  getTotalBalanceForCurrency(currency: string): number {
    const row = this.db.prepare(
      'SELECT SUM(balance) as total FROM wallets WHERE currency = ?'
    ).get(currency) as { total: number };
    return row.total;
  }
}
