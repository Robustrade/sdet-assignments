import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Wallet, Transfer, IdempotencyKey, TransferEvent, OutboxEvent } from '../service/db';

/**
 * Direct SQLite read/seed helpers for test assertions.
 * Tests use this to verify DB state independently of the API layer.
 */
export class DbHelpers {
  private readonly db: Db;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: false });
  }

  // ── Seeding ───────────────────────────────────────────────────────────────

  /** Create (or reset) a wallet to a known balance. Safe to call multiple times. */
  seedWallet(id: string, balance: number, currency: string): Wallet {
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT OR REPLACE INTO wallets (id, balance, currency, created_at) VALUES (?, ?, ?, ?)')
      .run(id, balance, currency, now);
    return this.getWallet(id);
  }

  /**
   * Seed a fresh source + destination wallet pair with UUID-based IDs.
   * Calling this per-test guarantees full isolation — no balance bleed between tests.
   */
  seedTestWallets(
    sourceBalance: number,
    destBalance: number,
    currency = 'AED',
  ): { sourceId: string; destId: string } {
    const sourceId = `w_src_${uuidv4()}`;
    const destId = `w_dst_${uuidv4()}`;
    this.seedWallet(sourceId, sourceBalance, currency);
    this.seedWallet(destId, destBalance, currency);
    return { sourceId, destId };
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getWallet(id: string): Wallet {
    const row = this.db.prepare('SELECT * FROM wallets WHERE id = ?').get(id) as Wallet | undefined;
    if (!row) throw new Error(`Wallet not found in DB: ${id}`);
    return row;
  }

  getTransfer(id: string): Transfer {
    const row = this.db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as Transfer | undefined;
    if (!row) throw new Error(`Transfer not found in DB: ${id}`);
    return row;
  }

  getTransfersByIdempotencyKey(key: string): Transfer[] {
    return this.db
      .prepare('SELECT * FROM transfers WHERE idempotency_key = ?')
      .all(key) as Transfer[];
  }

  getIdempotencyRecord(key: string): IdempotencyKey | undefined {
    return this.db
      .prepare('SELECT * FROM idempotency_keys WHERE key = ?')
      .get(key) as IdempotencyKey | undefined;
  }

  getTransferEvents(transferId: string): TransferEvent[] {
    return this.db
      .prepare('SELECT * FROM transfer_events WHERE transfer_id = ? ORDER BY created_at')
      .all(transferId) as TransferEvent[];
  }

  getOutboxEvents(transferId: string): OutboxEvent[] {
    return this.db
      .prepare('SELECT * FROM outbox_events WHERE transfer_id = ?')
      .all(transferId) as OutboxEvent[];
  }

  countTransfersForWallet(walletId: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM transfers WHERE source_wallet_id = ? OR destination_wallet_id = ?',
      )
      .get(walletId, walletId) as { n: number };
    return row.n;
  }

  countOutboxEventsForTransfer(transferId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM outbox_events WHERE transfer_id = ?')
      .get(transferId) as { n: number };
    return row.n;
  }

  getTotalBalance(currency = 'AED'): number {
    const row = this.db
      .prepare('SELECT SUM(balance) AS total FROM wallets WHERE currency = ?')
      .get(currency) as { total: number | null };
    return row.total ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
