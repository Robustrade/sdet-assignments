
import { describe, it, expect, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';

describe('Database initialization', () => {
  let db: AppDatabase;

  afterEach(() => {
    db?.close();
  });

  it('should create all required database tables', async () => {
    db = await createDatabase();

    const result = db.exec(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name;
    `);

    const tableNames = result[0].values.map(row => row[0]);

    expect(tableNames).toContain('customers');
    expect(tableNames).toContain('subscriptions');
    expect(tableNames).toContain('invoices');
    expect(tableNames).toContain('payments');
    expect(tableNames).toContain('webhook_events');
    expect(tableNames).toContain('idempotency_keys');
  });

  it('should reject duplicate webhook event IDs', async () => {
    db = await createDatabase();

    db.run(
      `INSERT INTO webhook_events
       (id, provider_event_id, event_type, payload)
       VALUES (?, ?, ?, ?)`,
      ['wh_1', 'evt_123', 'payment.succeeded', '{}']
    );

    expect(() => {
      db.run(
        `INSERT INTO webhook_events
         (id, provider_event_id, event_type, payload)
         VALUES (?, ?, ?, ?)`,
        ['wh_2', 'evt_123', 'payment.succeeded', '{}']
      );
    }).toThrow();
  });
});
