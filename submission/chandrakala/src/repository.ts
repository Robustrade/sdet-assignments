import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Subscription, Invoice, PaymentStatus, WebhookEvent } from './domain.ts';

export interface Payment {
  invoice_id: string; status: PaymentStatus; created_at: string;
}
export interface Audit {
  subscription_id: string; action: string; from_status: string;
  to_status: string; created_at: string;
}
export interface StoredEvent extends WebhookEvent {
  payload_hash: string; outcome: string; received_at: string;
}

/** SQL is confined here; callers operate on typed domain records. */
export class BillingRepository {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
        payment_method_id TEXT NOT NULL, plan TEXT NOT NULL CHECK(plan IN ('basic','pro')),
        status TEXT NOT NULL CHECK(status IN ('trialing','active','past_due','canceled')),
        trial_end TEXT NOT NULL, failures INTEGER NOT NULL CHECK(failures >= 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
        sequence INTEGER NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0),
        currency TEXT NOT NULL CHECK(currency = 'USD'),
        status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','refunded')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(subscription_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS payments (
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        status TEXT NOT NULL CHECK(status IN ('succeeded','failed','refunded')),
        created_at TEXT NOT NULL, PRIMARY KEY(invoice_id, status)
      );
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY, type TEXT NOT NULL,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
        invoice_id TEXT NOT NULL REFERENCES invoices(id), amount INTEGER NOT NULL,
        currency TEXT NOT NULL, payload_hash TEXT NOT NULL, outcome TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id INTEGER PRIMARY KEY, event_id TEXT NOT NULL REFERENCES webhook_events(event_id),
        outcome TEXT NOT NULL, received_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
        action TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  private many<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  seedCustomer(id: string): void {
    this.db.prepare('INSERT OR IGNORE INTO customers VALUES (?)').run(id);
  }
  hasCustomer(id: string): boolean {
    return !!this.one('SELECT id FROM customers WHERE id=?', id);
  }
  addSubscription(s: Subscription): void {
    this.db.prepare('INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?)').run(
      s.id, s.customer_id, s.payment_method_id, s.plan, s.status, s.trial_end,
      s.failures, s.created_at, s.updated_at,
    );
  }
  subscription(id: string): Subscription | undefined {
    return this.one('SELECT * FROM subscriptions WHERE id=?', id);
  }
  saveSubscription(s: Subscription): void {
    this.db.prepare(`UPDATE subscriptions SET plan=?, status=?, failures=?, updated_at=? WHERE id=?`)
      .run(s.plan, s.status, s.failures, s.updated_at, s.id);
  }
  addInvoice(i: Invoice): void {
    this.db.prepare('INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?)').run(
      i.id, i.subscription_id, i.sequence, i.amount, i.currency, i.status, i.created_at, i.updated_at,
    );
  }
  invoice(id: string): Invoice | undefined {
    return this.one('SELECT * FROM invoices WHERE id=?', id);
  }
  invoices(id: string): Invoice[] {
    return this.many('SELECT * FROM invoices WHERE subscription_id=? ORDER BY sequence', id);
  }
  saveInvoice(i: Invoice): void {
    this.db.prepare('UPDATE invoices SET status=?,updated_at=? WHERE id=?')
      .run(i.status, i.updated_at, i.id);
  }
  addPayment(invoiceId: string, status: PaymentStatus, now: string): void {
    this.db.prepare('INSERT INTO payments VALUES (?,?,?)').run(invoiceId, status, now);
  }
  payments(id: string): Payment[] {
    return this.many(`SELECT p.* FROM payments p JOIN invoices i ON i.id=p.invoice_id
      WHERE i.subscription_id=? ORDER BY i.sequence, p.rowid`, id);
  }
  event(id: string): StoredEvent | undefined {
    return this.one('SELECT * FROM webhook_events WHERE event_id=?', id);
  }
  recordEvent(event: WebhookEvent, hash: string, outcome: string, now: string): void {
    this.db.prepare('INSERT INTO webhook_events VALUES (?,?,?,?,?,?,?,?,?)').run(
      event.event_id, event.type, event.subscription_id, event.invoice_id,
      event.amount, event.currency, hash, outcome, now,
    );
  }
  recordDelivery(id: string, outcome: string, now: string): void {
    this.db.prepare('INSERT INTO webhook_deliveries(event_id,outcome,received_at) VALUES (?,?,?)')
      .run(id, outcome, now);
  }
  events(id: string): StoredEvent[] {
    return this.many('SELECT * FROM webhook_events WHERE subscription_id=? ORDER BY rowid', id);
  }
  deliveries(id: string): {event_id: string; outcome: string; received_at: string}[] {
    return this.many(`SELECT d.event_id,d.outcome,d.received_at FROM webhook_deliveries d
      JOIN webhook_events e ON e.event_id=d.event_id WHERE e.subscription_id=? ORDER BY d.id`, id);
  }
  audit(id: string, action: string, from: string, to: string, now: string): void {
    this.db.prepare(`INSERT INTO audit_log(subscription_id,action,from_status,to_status,created_at)
      VALUES (?,?,?,?,?)`).run(id, action, from, to, now);
  }
  audits(id: string): Audit[] {
    return this.many(`SELECT subscription_id,action,from_status,to_status,created_at
      FROM audit_log WHERE subscription_id=? ORDER BY id`, id);
  }
  counts(): Record<string, number> {
    const tables = ['subscriptions','invoices','payments','webhook_events','webhook_deliveries','audit_log'];
    return Object.fromEntries(tables.map(table => [table,
      this.one<{n: number}>(`SELECT COUNT(*) AS n FROM ${table}`)!.n]));
  }
  close(): void { this.db.close(); }
}
