
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository';
import { PaymentRepository } from '../../src/repositories/PaymentRepository';
import { createCustomer } from '../../src/models/Customer';
import { createSubscription } from '../../src/models/Subscription';
import { createInvoice } from '../../src/models/Invoice';
import { createPayment } from '../../src/models/Payment';

describe('Payment Repository', () => {
  let db: AppDatabase;
  let repository: PaymentRepository;

  beforeEach(async () => {
    db = await createDatabase();

    const customerRepository = new CustomerRepository(db);
    const subscriptionRepository = new SubscriptionRepository(db);
    const invoiceRepository = new InvoiceRepository(db);

    repository = new PaymentRepository(db);

    customerRepository.create(
      createCustomer('cust_001', 'test@example.com')
    );

    subscriptionRepository.create(
      createSubscription('sub_001', 'cust_001', 'premium')
    );

    invoiceRepository.create(
      createInvoice(
        'inv_001',
        'sub_001',
        2999,
        '2026-11-01',
        '2026-12-01'
      )
    );
  });

  afterEach(() => {
    db.close();
  });

  it('should create and retrieve a payment', () => {
    repository.create(
      createPayment('pay_001', 'inv_001', 2999)
    );

    const result = repository.findById('pay_001');

    expect(result).toBeDefined();
    expect(result?.amountCents).toBe(2999);
    expect(result?.status).toBe('pending');
  });

  it('should update payment status to succeeded', () => {
    repository.create(
      createPayment('pay_002', 'inv_001', 2999)
    );

    repository.updateStatus(
      'pay_002',
      'succeeded',
      'provider_123'
    );

    const result = repository.findById('pay_002');

    expect(result?.status).toBe('succeeded');
    expect(result?.providerPaymentId).toBe('provider_123');
  });

  it('should update payment status to failed', () => {
    repository.create(
      createPayment('pay_003', 'inv_001', 2999)
    );

    repository.updateStatus('pay_003', 'failed');

    expect(repository.findById('pay_003')?.status).toBe('failed');
  });

  it('should reject duplicate provider payment IDs', () => {
    repository.create(
      createPayment('pay_004', 'inv_001', 2999)
    );

    repository.updateStatus(
      'pay_004',
      'succeeded',
      'provider_duplicate'
    );

    repository.create(
      createPayment('pay_005', 'inv_001', 2999)
    );

    expect(() => {
      repository.updateStatus(
        'pay_005',
        'succeeded',
        'provider_duplicate'
      );
    }).toThrow();
  });

  it('should reject updates for unknown payments', () => {
    expect(() => {
      repository.updateStatus('unknown', 'succeeded');
    }).toThrow('Payment not found: unknown');
  });

  it('should return undefined for unknown payments', () => {
    expect(repository.findById('unknown')).toBeUndefined();
  });
});
