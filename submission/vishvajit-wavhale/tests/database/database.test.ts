
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { SqliteDatabase } from '../../src/database/Database.js';
import { initializeSchema } from '../../src/database/DatabaseSchema.js';
import { DatabaseSeeder } from '../../src/database/DatabaseSeeder.js';

describe('Database Framework', () => {

  let database: SqliteDatabase;

  beforeEach(() => {
    database = new SqliteDatabase();

    initializeSchema(database.connection);

    const seeder = new DatabaseSeeder(
      database.connection
    );

    seeder.seed();
  });

  afterEach(() => {
    database.close();
  });

  it('should create all required database tables', () => {
    const result = database.connection
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
      `)
      .all() as Array<{ name: string }>;

    const tableNames = result.map(table => table.name);

    expect(tableNames).toContain('customers');
    expect(tableNames).toContain('plans');
    expect(tableNames).toContain('subscriptions');
    expect(tableNames).toContain('invoices');
    expect(tableNames).toContain('webhook_events');
    expect(tableNames).toContain('audit_logs');
  });

  it('should seed customers successfully', () => {
    const result = database.connection
      .prepare('SELECT COUNT(*) AS count FROM customers')
      .get() as { count: number };

    expect(result.count).toBe(2);
  });

  it('should seed subscription plans successfully', () => {
    const plans = database.connection
      .prepare('SELECT * FROM plans')
      .all() as Array<{
        name: string;
        price_cents: number;
        trial_days: number;
      }>;

    expect(plans).toHaveLength(2);

    const proPlan = plans.find(
      plan => plan.name === 'pro'
    );

    expect(proPlan).toBeDefined();
    expect(proPlan?.price_cents).toBe(4900);
    expect(proPlan?.trial_days).toBe(14);
  });

  it('should prevent duplicate webhook event IDs', () => {
    const insertWebhook = database.connection.prepare(`
      INSERT INTO webhook_events (
        event_id,
        event_type,
        payload_json,
        processing_status
      )
      VALUES (?, ?, ?, ?)
    `);

    insertWebhook.run(
      'evt_001',
      'payment.succeeded',
      '{}',
      'received'
    );

    expect(() => {
      insertWebhook.run(
        'evt_001',
        'payment.succeeded',
        '{}',
        'received'
      );
    }).toThrow();
  });

  it('should prevent unsupported subscription statuses', () => {
    expect(() => {
      database.connection.prepare(`
        INSERT INTO subscriptions (
          id,
          customer_id,
          plan_id,
          payment_method_id,
          status
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'sub_001',
        'cust_001',
        'plan_pro',
        'pm_test_visa_4242',
        'pending'
      );
    }).toThrow();
  });

});
