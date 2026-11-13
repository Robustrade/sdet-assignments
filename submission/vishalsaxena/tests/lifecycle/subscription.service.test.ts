
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { SubscriptionService } from '../../src/services/SubscriptionService';
import { createCustomer } from '../../src/models/Customer';

describe('Subscription Service', () => {
  let db: AppDatabase;
  let customerRepository: CustomerRepository;
  let subscriptionRepository: SubscriptionRepository;
  let service: SubscriptionService;

  beforeEach(async () => {
    db = await createDatabase();

    customerRepository = new CustomerRepository(db);
    subscriptionRepository = new SubscriptionRepository(db);

    customerRepository.create(
      createCustomer('cust_001', 'test@example.com')
    );

    service = new SubscriptionService(
      customerRepository,
      subscriptionRepository
    );
  });

  afterEach(() => {
    db.close();
  });

  it('should create a subscription for an existing customer', () => {
    const result = service.create(
      'sub_001',
      'cust_001',
      'premium'
    );

    expect(result.id).toBe('sub_001');
    expect(result.status).toBe('trialing');
    expect(
      subscriptionRepository.findById('sub_001')
    ).toBeDefined();
  });

  it('should reject subscription creation for an unknown customer', () => {
    expect(() => {
      service.create('sub_002', 'cust_unknown', 'premium');
    }).toThrow('Customer not found: cust_unknown');
  });

  it('should retrieve an existing subscription', () => {
    service.create('sub_003', 'cust_001', 'premium');

    const result = service.getById('sub_003');

    expect(result.id).toBe('sub_003');
    expect(result.customerId).toBe('cust_001');
  });

  it('should reject retrieval of an unknown subscription', () => {
    expect(() => {
      service.getById('sub_unknown');
    }).toThrow('Subscription not found: sub_unknown');
  });

  it('should cancel an existing subscription', () => {
    service.create('sub_004', 'cust_001', 'premium');

    const result = service.cancel('sub_004');

    expect(result.status).toBe('canceled');
    expect(
      subscriptionRepository.findById('sub_004')?.status
    ).toBe('canceled');
  });

  it('should reject cancellation of an already canceled subscription', () => {
    service.create('sub_005', 'cust_001', 'premium');
    service.cancel('sub_005');

    expect(() => {
      service.cancel('sub_005');
    }).toThrow('Cannot cancel subscription with status: canceled');
  });
});
