
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { createCustomer } from '../../src/models/Customer';
import { createSubscription } from '../../src/models/Subscription';

describe('Subscription Repository', () => {
  let db: AppDatabase;
  let repository: SubscriptionRepository;

  beforeEach(async () => {
    db = await createDatabase();

    const customerRepository = new CustomerRepository(db);
    repository = new SubscriptionRepository(db);

    customerRepository.create(
      createCustomer('cust_001', 'test@example.com')
    );
  });

  afterEach(() => {
    db.close();
  });

  it('should create and retrieve a subscription', () => {
    const subscription = createSubscription(
      'sub_001',
      'cust_001',
      'premium',
      'trialing'
    );

    repository.create(subscription);

    const result = repository.findById('sub_001');

    expect(result).toBeDefined();
    expect(result?.customerId).toBe('cust_001');
    expect(result?.planId).toBe('premium');
    expect(result?.status).toBe('trialing');
  });

  it('should update subscription status', () => {
    repository.create(
      createSubscription('sub_002', 'cust_001', 'basic')
    );

    repository.updateStatus('sub_002', 'active');

    const result = repository.findById('sub_002');

    expect(result?.status).toBe('active');
  });

  it('should reject updates for unknown subscriptions', () => {
    expect(() => {
      repository.updateStatus('unknown', 'active');
    }).toThrow('Subscription not found: unknown');
  });

  it('should return undefined for unknown subscriptions', () => {
    expect(repository.findById('unknown')).toBeUndefined();
  });

  it('should reject subscriptions with unknown customers', () => {
    expect(() => {
      repository.create(
        createSubscription('sub_003', 'unknown_customer', 'premium')
      );
    }).toThrow();
  });
});
