
import { createDatabase } from '../../src/utils/database';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { Subscription } from '../../src/models/Subscription';

describe('SubscriptionRepository', () => {
    let db: ReturnType<typeof createDatabase>;
    let repository: SubscriptionRepository;

    const subscription: Subscription = {
        id: 'sub-001',
        customerId: 'cust-001',
        plan: 'basic',
        status: 'active',
        amount: 499,
        currency: 'INR',
        paymentMethodId: 'pm-001',
        trialStartsAt: new Date('2026-11-11T00:00:00.000Z'),
        trialEndsAt: new Date('2026-11-18T00:00:00.000Z'),
        createdAt: new Date('2026-11-11T10:00:00.000Z'),
        updatedAt: new Date('2026-11-11T10:00:00.000Z')
    };

    beforeEach(() => {
        db = createDatabase();
        repository = new SubscriptionRepository(db);
    });

    afterEach(() => {
        db.close();
    });

    it('should create and retrieve a subscription', () => {
        repository.create(subscription);

        const result = repository.findById('sub-001');

        expect(result).toEqual(subscription);
    });

    it('should return undefined for an unknown subscription', () => {
        expect(repository.findById('unknown')).toBeUndefined();
    });

    it('should reject duplicate subscription IDs', () => {
        repository.create(subscription);

        expect(() => repository.create(subscription)).toThrow();
    });

    it('should update subscription status in database', () => {
        repository.create(subscription);

        repository.updateStatus('sub-001', 'past_due');

        expect(repository.findById('sub-001')?.status).toBe('past_due');
    });

    it('should throw when updating a missing subscription', () => {
        expect(() => {
            repository.updateStatus('unknown', 'past_due');
        }).toThrow('Subscription not found: unknown');
    });

    it('should find subscriptions by customer ID', () => {
        repository.create(subscription);

        const result = repository.findByCustomerId('cust-001');

        expect(result).toHaveLength(1);
        expect(result[0].customerId).toBe('cust-001');
    });
});
