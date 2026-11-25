
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
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository.js';

describe('SubscriptionRepository', () => {
  let database: SqliteDatabase;
  let repository: SubscriptionRepository;

  beforeEach(() => {
    database = new SqliteDatabase();
    initializeSchema(database.connection);

    const seeder = new DatabaseSeeder(database.connection);
    seeder.seed();

    repository = new SubscriptionRepository(database.connection);
  });

  afterEach(() => {
    database.close();
  });

  const subscriptionInput = {
    id: 'sub_001',
    customer_id: 'cust_001',
    plan_id: 'plan_basic',
    payment_method_id: 'pm_test_visa_4242',
    status: 'trialing' as const,
    trial_ends_at: '2026-12-02T00:00:00.000Z'
  };

  it('should create a subscription', () => {
    const subscription = repository.create(subscriptionInput);

    expect(subscription.id).toBe('sub_001');
    expect(subscription.customer_id).toBe('cust_001');
    expect(subscription.status).toBe('trialing');
  });

  it('should find a subscription by ID', () => {
    repository.create(subscriptionInput);

    const subscription = repository.findById('sub_001');

    expect(subscription).not.toBeNull();
    expect(subscription?.plan_id).toBe('plan_basic');
  });

  it('should return null for an unknown subscription', () => {
    expect(repository.findById('unknown')).toBeNull();
  });

  it('should find subscriptions by customer ID', () => {
    repository.create(subscriptionInput);

    const subscriptions = repository.findByCustomerId('cust_001');

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].id).toBe('sub_001');
  });

  it('should update subscription status', () => {
    repository.create(subscriptionInput);

    const updated = repository.updateStatus('sub_001', 'active');

    expect(updated.status).toBe('active');
  });

  it('should cancel a subscription', () => {
    repository.create(subscriptionInput);

    const canceled = repository.cancel(
      'sub_001',
      '2026-11-25T12:00:00.000Z'
    );

    expect(canceled.status).toBe('canceled');
    expect(canceled.canceled_at).toBe(
      '2026-11-25T12:00:00.000Z'
    );
  });

  it('should throw when updating an unknown subscription', () => {
    expect(() => {
      repository.updateStatus('unknown', 'active');
    }).toThrow('Subscription not found: unknown');
  });
});
