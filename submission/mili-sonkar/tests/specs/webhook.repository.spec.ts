import { describe, expect, it } from 'vitest';

import { WebhookRepository } from '../../src/infrastructure/repositories/WebhookRepository.js';
import { createDatabase } from '../../src/infrastructure/sqlite/db.js';

describe('WebhookRepository', () => {
    function createRepository() {
        const db = createDatabase();
        const repository = new WebhookRepository(db);

        return { db, repository };
    }

    it('claims a new webhook event', () => {
        const { db, repository } = createRepository();

        const claimed = repository.tryClaim(
            'evt-001',
            'payment.succeeded',
        );

        expect(claimed).toBe(true);
        expect(repository.exists('evt-001')).toBe(true);

        db.close();
    });

    it('does not claim the same webhook event twice', () => {
        const { db, repository } = createRepository();

        const firstClaim = repository.tryClaim(
            'evt-002',
            'payment.succeeded',
        );

        const secondClaim = repository.tryClaim(
            'evt-002',
            'payment.succeeded',
        );

        expect(firstClaim).toBe(true);
        expect(secondClaim).toBe(false);

        db.close();
    });

    it('retrieves a claimed webhook event', () => {
        const { db, repository } = createRepository();

        repository.tryClaim(
            'evt-003',
            'payment.failed',
        );

        const event = repository.getById('evt-003');

        expect(event).toEqual({
            eventId: 'evt-003',
            eventType: 'payment.failed',
            processingStatus: 'processing',
        });

        db.close();
    });

    it('marks a webhook as processed', () => {
        const { db, repository } = createRepository();

        repository.tryClaim(
            'evt-004',
            'payment.succeeded',
        );

        repository.markProcessed('evt-004');

        expect(
            repository.getById('evt-004')?.processingStatus,
        ).toBe('processed');

        db.close();
    });

    it('marks a webhook as failed', () => {
        const { db, repository } = createRepository();

        repository.tryClaim(
            'evt-005',
            'payment.failed',
        );

        repository.markFailed('evt-005');

        expect(
            repository.getById('evt-005')?.processingStatus,
        ).toBe('failed');

        db.close();
    });

    it('reclaims a failed webhook for a later delivery', () => {
        const { db, repository } = createRepository();

        repository.tryClaim('evt-retry-001', 'payment.succeeded');
        repository.markFailed('evt-retry-001');

        expect(
            repository.tryClaim('evt-retry-001', 'payment.succeeded'),
        ).toBe(true);

        expect(
            repository.getById('evt-retry-001')?.processingStatus,
        ).toBe('processing');

        db.close();
    });

    it('returns undefined when the event does not exist', () => {
        const { db, repository } = createRepository();

        expect(
            repository.getById('does-not-exist'),
        ).toBeUndefined();

        db.close();
    });
});