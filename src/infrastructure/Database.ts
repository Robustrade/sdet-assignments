import Database from 'better-sqlite3';
import { Subscription, SubscriptionState } from '../domain/Subscription';
import { PlanTier } from '../domain/Plan';

export class DB {
  private db: Database.Database;

  constructor(memory: boolean = true) {
    this.db = new Database(memory ? ':memory:' : 'data.db');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        state TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL,
        type TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS subscription_events (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        details TEXT NOT NULL,
        occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  saveSubscription(sub: Subscription) {
    const stmt = this.db.prepare(`
      INSERT INTO subscriptions (id, customer_id, plan, state)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state = excluded.state, plan = excluded.plan
    `);
    stmt.run(sub.id, sub.customerId, sub.plan, sub.state);
  }

  getSubscription(id: string): Subscription | null {
    const row = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as any;
    if (!row) return null;
    return new Subscription(row.id, row.customer_id, row.plan as PlanTier, row.state as SubscriptionState);
  }

  isEventProcessed(eventId: string): boolean {
    const row = this.db.prepare('SELECT event_id FROM webhook_events WHERE event_id = ?').get(eventId);
    return !!row;
  }

  markEventProcessed(eventId: string) {
    this.db.prepare('INSERT INTO webhook_events (event_id) VALUES (?)').run(eventId);
  }

  saveInvoice(id: string, subId: string, amount: number, status: 'paid' | 'failed' | 'refunded', type: string) {
    this.db.prepare('INSERT INTO invoices (id, subscription_id, amount, status, type) VALUES (?, ?, ?, ?, ?)').run(id, subId, amount, status, type);
  }

  getInvoice(id: string) {
    return this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  }

  getInvoices(subId: string): any[] {
    return this.db.prepare('SELECT * FROM invoices WHERE subscription_id = ?').all(subId);
  }

  logSubscriptionEvent(id: string, subId: string, eventType: string, details: string) {
    this.db.prepare('INSERT INTO subscription_events (id, subscription_id, event_type, details) VALUES (?, ?, ?, ?)').run(id, subId, eventType, details);
  }

  getSubscriptionEvents(subId: string) {
    return this.db.prepare('SELECT * FROM subscription_events WHERE subscription_id = ? ORDER BY occurred_at').all(subId);
  }

  close() {
    this.db.close();
  }
}
