
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository';
import { createCustomer } from '../../src/models/Customer';
import { createSubscription } from '../../src/models/Subscription';
import { createInvoice } from '../../src/models/Invoice';

describe('Invoice Repository', () => {
  let db: AppDatabase;
  let repository: InvoiceRepository;

  beforeEach(async () => {
    db = await createDatabase();

    const customerRepository = new CustomerRepository(db);
    const subscriptionRepository = new SubscriptionRepository(db);

    repository = new InvoiceRepository(db);

    customerRepository.create(
      createCustomer('cust_001', 'test@example.com')
    );

    subscriptionRepository.create(
      createSubscription('sub_001', 'cust_001', 'premium')
    );
  });

  afterEach(() => {
    db.close();
  });

  it('should create and retrieve an invoice', () => {
    const invoice = createInvoice(
      'inv_001',
      'sub_001',
      2999,
      '2026-11-01',
      '2026-12-01'
    );

    repository.create(invoice);

    const result = repository.findById('inv_001');

    expect(result).toBeDefined();
    expect(result?.amountCents).toBe(2999);
    expect(result?.status).toBe('open');
  });

  it('should update invoice status', () => {
    repository.create(
      createInvoice(
        'inv_002',
        'sub_001',
        2999,
        '2026-11-01',
        '2026-12-01'
      )
    );

    repository.updateStatus('inv_002', 'paid');

    expect(repository.findById('inv_002')?.status).toBe('paid');
  });

  it('should reject duplicate invoices for the same billing period', () => {
    repository.create(
      createInvoice(
        'inv_003',
        'sub_001',
        2999,
        '2026-11-01',
        '2026-12-01'
      )
    );

    expect(() => {
      repository.create(
        createInvoice(
          'inv_004',
          'sub_001',
          2999,
          '2026-11-01',
          '2026-12-01'
        )
      );
    }).toThrow();
  });

  it('should allow invoices for different billing periods', () => {
    repository.create(
      createInvoice(
        'inv_005',
        'sub_001',
        2999,
        '2026-11-01',
        '2026-12-01'
      )
    );

    expect(() => {
      repository.create(
        createInvoice(
          'inv_006',
          'sub_001',
          2999,
          '2026-12-01',
          '2027-01-01'
        )
      );
    }).not.toThrow();
  });

  it('should reject updates for unknown invoices', () => {
    expect(() => {
      repository.updateStatus('unknown', 'paid');
    }).toThrow('Invoice not found: unknown');
  });
});
