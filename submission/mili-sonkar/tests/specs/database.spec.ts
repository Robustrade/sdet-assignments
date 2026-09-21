import { describe, expect, it } from 'vitest';
import { createDatabase, runInTransaction } from '../../src/infrastructure/sqlite/db.js';

describe('SQLite database', () => {
    it('creates all required billing tables', () => {
        const db = createDatabase();

        const tables = db
            .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
            .all() as Array<{ name: string }>;

        expect(tables.map((table) => table.name)).toEqual([
            'audit_log',
            'idempotency_keys',
            'invoices',
            'reconciliation_events',
            'subscriptions',
            'webhook_events',
        ]);

        db.close();
    });

    it('enforces unique webhook event IDs', () => {
        const db = createDatabase();

        const insert = db.prepare(`
      INSERT INTO webhook_events (
        event_id,
        event_type,
        processing_status
      )
      VALUES (?, ?, ?)
    `);

        insert.run('event-001', 'payment.succeeded', 'processed');

        expect(() => {
            insert.run('event-001', 'payment.succeeded', 'processed');
        }).toThrow();

        db.close();
    });

    it('enforces unique idempotency keys', () => {
        const db = createDatabase();

        const insert = db.prepare(`
      INSERT INTO idempotency_keys (
        key,
        subscription_id,
        response_status,
        response_body,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `);

        insert.run(
            'idem-001',
            null,
            201,
            null,
            new Date().toISOString()
        );

        expect(() => {
            insert.run(
                'idem-001',
                null,
                201,
                null,
                new Date().toISOString()
            );
        }).toThrow();

        db.close();
    });

    it('rolls back a transaction when the operation fails', () => {
        const db = createDatabase();

        expect(() => {
            runInTransaction(db, () => {
                db.prepare(`
          INSERT INTO subscriptions (
            id,
            customer_id,
            plan,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
                    'sub-001',
                    'customer-001',
                    'basic',
                    'trialing',
                    new Date().toISOString(),
                    new Date().toISOString()
                );

                throw new Error('Simulated persistence failure');
            });
        }).toThrow('Simulated persistence failure');

        const subscription = db
            .prepare('SELECT * FROM subscriptions WHERE id = ?')
            .get('sub-001');

        expect(subscription).toBeUndefined();

        db.close();
    });

    it('accepts only valid subscription states', () => {
        const db = createDatabase();

        const insert = db.prepare(`
      INSERT INTO subscriptions (
        id,
        customer_id,
        plan,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);

        const timestamp = new Date().toISOString();

        expect(() => {
            insert.run(
                'sub-valid',
                'customer-001',
                'basic',
                'trialing',
                timestamp,
                timestamp
            );
        }).not.toThrow();

        expect(() => {
            insert.run(
                'sub-invalid',
                'customer-001',
                'basic',
                'unknown',
                timestamp,
                timestamp
            );
        }).toThrow();

        db.close();
    });
});