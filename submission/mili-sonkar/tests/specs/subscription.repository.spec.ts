import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/infrastructure/sqlite/db.js';
import { SubscriptionRepository } from '../../src/infrastructure/repositories/SubscriptionRepository.js';
import type { Subscription } from '../../src/domain/Subscription.js';
import type { DatabaseSync } from 'node:sqlite';

describe('SubscriptionRepository', () => {
    let db: DatabaseSync;
    let repository: SubscriptionRepository;

    beforeEach(() => {
        db = createDatabase();
        repository = new SubscriptionRepository(db);
    });

    it('creates and retrieves a subscription by ID', () => {
        const subscription: Subscription = {
            id: 'sub-001',
            customerId: 'customer-001',
            plan: 'basic',
            status: 'trialing',
            createdAt: '2026-09-18T10:00:00.000Z',
            updatedAt: '2026-09-18T10:00:00.000Z',
        };

        repository.create(subscription);

        expect(repository.getById('sub-001')).toEqual(subscription);

        db.close();
    });

    it('returns undefined when subscription does not exist', () => {
        expect(repository.getById('does-not-exist')).toBeUndefined();

        db.close();
    });

    it('retrieves subscriptions by customer ID', () => {
        const subscriptions: Subscription[] = [
            {
                id: 'sub-001',
                customerId: 'customer-001',
                plan: 'basic',
                status: 'trialing',
                createdAt: '2026-09-18T10:00:00.000Z',
                updatedAt: '2026-09-18T10:00:00.000Z',
            },
            {
                id: 'sub-002',
                customerId: 'customer-001',
                plan: 'pro',
                status: 'active',
                createdAt: '2026-09-18T11:00:00.000Z',
                updatedAt: '2026-09-18T11:00:00.000Z',
            },
            {
                id: 'sub-003',
                customerId: 'customer-002',
                plan: 'basic',
                status: 'trialing',
                createdAt: '2026-09-18T12:00:00.000Z',
                updatedAt: '2026-09-18T12:00:00.000Z',
            },
        ];

        subscriptions.forEach((subscription) => {
            repository.create(subscription);
        });

        expect(repository.getByCustomerId('customer-001')).toEqual([
            subscriptions[0],
            subscriptions[1],
        ]);

        db.close();
    });

    it('updates subscription status', () => {
        const subscription: Subscription = {
            id: 'sub-001',
            customerId: 'customer-001',
            plan: 'basic',
            status: 'trialing',
            createdAt: '2026-09-18T10:00:00.000Z',
            updatedAt: '2026-09-18T10:00:00.000Z',
        };

        repository.create(subscription);

        repository.updateStatus(
            'sub-001',
            'active',
            '2026-09-18T11:00:00.000Z'
        );

        expect(repository.getById('sub-001')).toEqual({
            ...subscription,
            status: 'active',
            updatedAt: '2026-09-18T11:00:00.000Z',
        });

        db.close();
    });

    it('does not create a subscription with an invalid status', () => {
        const subscription = {
            id: 'sub-invalid',
            customerId: 'customer-001',
            plan: 'basic',
            status: 'invalid',
            createdAt: '2026-09-18T10:00:00.000Z',
            updatedAt: '2026-09-18T10:00:00.000Z',
        };

        expect(() => {
            repository.create(
                subscription as unknown as Subscription
            );
        }).toThrow();

        db.close();
    });
});