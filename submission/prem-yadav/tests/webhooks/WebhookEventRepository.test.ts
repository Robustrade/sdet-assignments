
import { createDatabase } from '../../src/utils/database';
import { WebhookEventRepository } from '../../src/repositories/WebhookEventRepository';

describe('WebhookEventRepository', () => {
    let db: ReturnType<typeof createDatabase>;
    let repository: WebhookEventRepository;


    beforeEach(() => {
        db = createDatabase();
        repository = new WebhookEventRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    it('should record a new webhook event', () => {
        const result = repository.recordIfNew(
            'evt-001',
            'payment.succeeded'
        );

        expect(result).toBe(true);
        expect(repository.hasProcessed('evt-001')).toBe(true);
    });


    it('should reject a duplicate webhook event', () => {
        repository.recordIfNew('evt-001', 'payment.succeeded');

        const duplicate = repository.recordIfNew(
            'evt-001',
            'payment.succeeded'
        );

        expect(duplicate).toBe(false);
    });

    it('should allow different webhook event IDs', () => {
        expect(
            repository.recordIfNew('evt-001', 'payment.succeeded')
        ).toBe(true);

        expect(
            repository.recordIfNew('evt-002', 'payment.failed')
        ).toBe(true);
    });

    it('should return false for an unknown event ID', () => {
        expect(repository.hasProcessed('evt-unknown')).toBe(false);
    });

    it('should reject missing event ID or event type', () => {
        expect(() => repository.recordIfNew('', 'payment.succeeded'))
            .toThrow('Event ID and event type are required');

        expect(() => repository.recordIfNew('evt-001', ''))
            .toThrow('Event ID and event type are required');
    });
});
