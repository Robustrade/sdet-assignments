
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
import { CustomerRepository } from '../../src/repositories/CustomerRepository.js';

describe('CustomerRepository', () => {
  let database: SqliteDatabase;
  let customerRepository: CustomerRepository;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    database = new SqliteDatabase();

    // Create database tables
    initializeSchema(database.connection);

    // Insert test customers and plans
    const seeder = new DatabaseSeeder(database.connection);
    seeder.seed();

    // Initialize repository
    customerRepository = new CustomerRepository(
      database.connection
    );
  });

  afterEach(() => {
    // Close database after every test
    database.close();
  });

  it('should create a customer successfully', () => {
    const customer = customerRepository.create({
      id: 'cust_003',
      name: 'Test Customer Three',
      email: 'customer3@example.com'
    });

    expect(customer.id).toBe('cust_003');
    expect(customer.name).toBe('Test Customer Three');
    expect(customer.email).toBe('customer3@example.com');
  });

  it('should find customer by ID', () => {
    const customer = customerRepository.findById('cust_001');

    expect(customer).not.toBeNull();
    expect(customer?.name).toBe('Test Customer One');
  });

  it('should find customer by email', () => {
    const customer = customerRepository.findByEmail(
      'customer1@example.com'
    );

    expect(customer).not.toBeNull();
    expect(customer?.id).toBe('cust_001');
  });

  it('should return null for an unknown customer', () => {
    const customer = customerRepository.findById('unknown_id');

    expect(customer).toBeNull();
  });

  it('should reject duplicate customer email', () => {
    expect(() => {
      customerRepository.create({
        id: 'cust_004',
        name: 'Duplicate Customer',
        email: 'customer1@example.com'
      });
    }).toThrow();
  });
});
