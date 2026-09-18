import { describe, expect, it } from 'vitest';

import { AuditRepository } from '../../src/infrastructure/repositories/AuditRepository.js';
import { createDatabase } from '../../src/infrastructure/sqlite/db.js';

describe('AuditRepository', () => {
    function createRepository() {
        const db = createDatabase();

        // audit_log.subscription_id has a FK to subscriptions.id,
        // so every audit test must create its prerequisite subscription.
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
            '2026-09-18T09:00:00.000Z',
            '2026-09-18T09:00:00.000Z',
        );

        const repository = new AuditRepository(db);

        return { db, repository };
    }

    const auditRecord = {
        subscriptionId: 'sub-001',
        oldState: 'trialing',
        newState: 'active',
        eventType: 'payment.succeeded',
        correlationId: 'corr-001',
        createdAt: '2026-09-18T10:00:00.000Z',
    };

    it('creates an audit record', () => {
        const { db, repository } = createRepository();

        repository.create(auditRecord);

        const records = repository.getBySubscriptionId('sub-001');

        expect(records).toHaveLength(1);

        db.close();
    });

    it('stores the state transition correctly', () => {
        const { db, repository } = createRepository();

        repository.create(auditRecord);

        const record =
            repository.getLatestBySubscriptionId('sub-001');

        expect(record?.oldState).toBe('trialing');
        expect(record?.newState).toBe('active');

        db.close();
    });

    it('stores the event type and correlation ID', () => {
        const { db, repository } = createRepository();

        repository.create(auditRecord);

        const record =
            repository.getLatestBySubscriptionId('sub-001');

        expect(record?.eventType).toBe('payment.succeeded');
        expect(record?.correlationId).toBe('corr-001');

        db.close();
    });

    it('returns audit history in chronological order', () => {
        const { db, repository } = createRepository();

        repository.create({
            ...auditRecord,
            createdAt: '2026-09-18T10:00:00.000Z',
        });

        repository.create({
            ...auditRecord,
            oldState: 'active',
            newState: 'past_due',
            eventType: 'payment.failed',
            correlationId: 'corr-002',
            createdAt: '2026-09-18T11:00:00.000Z',
        });

        const records =
            repository.getBySubscriptionId('sub-001');

        expect(records).toHaveLength(2);
        expect(records[0].newState).toBe('active');
        expect(records[1].newState).toBe('past_due');

        db.close();
    });

    it('returns the latest audit record', () => {
        const { db, repository } = createRepository();

        repository.create(auditRecord);

        repository.create({
            ...auditRecord,
            oldState: 'active',
            newState: 'past_due',
            eventType: 'payment.failed',
            correlationId: 'corr-002',
            createdAt: '2026-09-18T11:00:00.000Z',
        });

        const latest =
            repository.getLatestBySubscriptionId('sub-001');

        expect(latest?.oldState).toBe('active');
        expect(latest?.newState).toBe('past_due');
        expect(latest?.correlationId).toBe('corr-002');

        db.close();
    });
});
