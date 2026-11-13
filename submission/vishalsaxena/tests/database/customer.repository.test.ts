
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { createCustomer } from '../../src/models/Customer';

describe('Customer Repository', () => {
  let db: AppDatabase;
  let repository: CustomerRepository;

  beforeEach(async () => {
    db = await createDatabase();
    repository = new CustomerRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create and retrieve a customer by ID', () => {
    const customer = createCustomer(
      'cust_001',
      'test@example.com'
    );

    repository.create(customer);

    const result = repository.findById('cust_001');

    expect(result).toBeDefined();
    expect(result?.email).toBe('test@example.com');
  });

  it('should retrieve a customer by email', () => {
    const customer = createCustomer(
      'cust_002',
      'TEST@example.com'
    );

    repository.create(customer);

    const result = repository.findByEmail('test@example.com');

    expect(result?.id).toBe('cust_002');
    expect(result?.email).toBe('test@example.com');
  });

  it('should reject duplicate customer emails', () => {
    repository.create(
      createCustomer('cust_003', 'duplicate@example.com')
    );

    expect(() => {
      repository.create(
        createCustomer('cust_004', 'duplicate@example.com')
      );
    }).toThrow();
  });

  it('should return undefined for an unknown customer', () => {
    expect(repository.findById('unknown')).toBeUndefined();
  });
});
