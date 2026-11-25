
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
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository.js';

describe('InvoiceRepository', () => {
  let database: SqliteDatabase;
  let subscriptionRepository: SubscriptionRepository;
  let invoiceRepository: InvoiceRepository;

  beforeEach(() => {
    database = new SqliteDatabase();
    initializeSchema(database.connection);

    const seeder = new DatabaseSeeder(database.connection);
    seeder.seed();

    subscriptionRepository = new SubscriptionRepository(
      database.connection
    );

    subscriptionRepository.create({
      id: 'sub_001',
      customer_id: 'cust_001',
      plan_id: 'plan_basic',
      payment_method_id: 'pm_test_visa_4242',
      status: 'trialing'
    });

    invoiceRepository = new InvoiceRepository(
      database.connection
    );
  });

  afterEach(() => {
    database.close();
  });

  it('should create a pending invoice', () => {
    const invoice = invoiceRepository.create({
      id: 'inv_001',
      subscription_id: 'sub_001',
      amount: 1900,
      currency: 'USD'
    });

    expect(invoice.id).toBe('inv_001');
    expect(invoice.amount).toBe(1900);
    expect(invoice.status).toBe('pending');
  });

  it('should find invoice by ID', () => {
    invoiceRepository.create({
      id: 'inv_001',
      subscription_id: 'sub_001',
      amount: 1900,
      currency: 'USD'
    });

    const invoice = invoiceRepository.findById('inv_001');

    expect(invoice).not.toBeNull();
    expect(invoice?.subscription_id).toBe('sub_001');
  });

  it('should return null for an unknown invoice', () => {
    expect(invoiceRepository.findById('unknown')).toBeNull();
  });

  it('should find invoices by subscription ID', () => {
    invoiceRepository.create({
      id: 'inv_001',
      subscription_id: 'sub_001',
      amount: 1900,
      currency: 'USD'
    });

    invoiceRepository.create({
      id: 'inv_002',
      subscription_id: 'sub_001',
      amount: 1900,
      currency: 'USD'
    });

    const invoices =
      invoiceRepository.findBySubscriptionId('sub_001');

    expect(invoices).toHaveLength(2);
  });

  it('should mark an invoice as succeeded', () => {
    invoiceRepository.create({
      id: 'inv_001',
      subscription_id: 'sub_001',
      amount: 1900,
      currency: 'USD'
    });

    const invoice = invoiceRepository.updatePaymentResult(
      'inv_001',
      {
        status: 'succeeded',
        provider_reference: 'pay_test_001'
      }
    );

    expect(invoice.status).toBe('succeeded');
    expect(invoice.provider_reference).toBe('pay_test_001');
    expect(invoice.failure_reason).toBeNull();
  });

  it('should mark an invoice as failed', () => {
    invoiceRepository.create({
      id: 'inv_001',
      subscription_id: 'sub_001',
      amount: 1900,
      currency: 'USD'
    });

    const invoice = invoiceRepository.updatePaymentResult(
      'inv_001',
      {
        status: 'failed',
        failure_reason: 'Insufficient funds'
      }
    );

    expect(invoice.status).toBe('failed');
    expect(invoice.failure_reason).toBe('Insufficient funds');
  });

  it('should throw when updating an unknown invoice', () => {
    expect(() => {
      invoiceRepository.updatePaymentResult('unknown', {
        status: 'succeeded'
      });
    }).toThrow('Invoice not found: unknown');
  });
});
