
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository';
import { PaymentRepository } from '../../src/repositories/PaymentRepository';
import { PaymentService } from '../../src/services/PaymentService';
import { MockPaymentProvider } from '../../src/providers/MockPaymentProvider';
import { createCustomer } from '../../src/models/Customer';
import { createSubscription } from '../../src/models/Subscription';
import { createInvoice } from '../../src/models/Invoice';

describe('Payment Service', () => {
  let db: AppDatabase;
  let invoiceRepository: InvoiceRepository;
  let paymentRepository: PaymentRepository;
  let subscriptionRepository: SubscriptionRepository;
  let provider: MockPaymentProvider;
  let service: PaymentService;

  beforeEach(async () => {
    db = await createDatabase();

    const customerRepository = new CustomerRepository(db);
    subscriptionRepository = new SubscriptionRepository(db);
    invoiceRepository = new InvoiceRepository(db);
    paymentRepository = new PaymentRepository(db);
    provider = new MockPaymentProvider();

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

    service = new PaymentService(
      db,
      invoiceRepository,
      paymentRepository,
      subscriptionRepository,
      provider
    );
  });

  afterEach(() => {
    db.close();
  });

  it('should process a successful payment', async () => {
    const result = await service.processPayment('inv_001', 'pay_001');

    expect(result?.status).toBe('succeeded');
    expect(result?.providerPaymentId).toBe('pay_inv_001');
    expect(invoiceRepository.findById('inv_001')?.status).toBe('paid');
    expect(subscriptionRepository.findById('sub_001')?.status).toBe('active');
  });

  it('should mark payment as failed when provider declines', async () => {
    provider.setScenario('decline');

    const result = await service.processPayment('inv_001', 'pay_002');

    expect(result?.status).toBe('failed');
    expect(invoiceRepository.findById('inv_001')?.status).toBe('open');
    expect(subscriptionRepository.findById('sub_001')?.status).toBe('trialing');
  });

  it('should keep payment pending when provider times out', async () => {
    provider.setScenario('timeout');

    await expect(
      service.processPayment('inv_001', 'pay_003')
    ).rejects.toThrow('Payment provider timeout');

    expect(paymentRepository.findById('pay_003')?.status).toBe('pending');
    expect(invoiceRepository.findById('inv_001')?.status).toBe('open');
    expect(subscriptionRepository.findById('sub_001')?.status).toBe('trialing');
  });

  it('should recover a pending payment after a provider timeout', async () => {
    provider.setScenario('timeout');
  
    await expect(
      service.processPayment('inv_001', 'pay_retry_001')
    ).rejects.toThrow('Payment provider timeout');
  
    expect(
      paymentRepository.findById('pay_retry_001')?.status
    ).toBe('pending');
  
    // Simulate the provider becoming available.
    provider.setScenario('success');
  
    const result = await service.processPayment(
      'inv_001',
      'pay_retry_001'
    );
  
    expect(result?.status).toBe('succeeded');
    expect(result?.providerPaymentId).toBe('pay_inv_001');
    expect(invoiceRepository.findById('inv_001')?.status).toBe('paid');
    expect(subscriptionRepository.findById('sub_001')?.status).toBe('active');
  
    expect(
      paymentRepository.findByInvoiceId('inv_001')?.id
    ).toBe('pay_retry_001');
  });

  it('should reject payment for an unknown invoice', async () => {
    await expect(
      service.processPayment('inv_unknown', 'pay_004')
    ).rejects.toThrow('Invoice not found: inv_unknown');
  });

  it('should reject payment for an already paid invoice', async () => {
    await service.processPayment('inv_001', 'pay_005');

    await expect(
      service.processPayment('inv_001', 'pay_006')
    ).rejects.toThrow('Invoice is not payable: paid');
  });

  it('should reject payment for a canceled subscription', async () => {
    subscriptionRepository.updateStatus('sub_001', 'canceled');

    await expect(
      service.processPayment('inv_001', 'pay_007')
    ).rejects.toThrow('Cannot process payment for a canceled subscription');
  });

  it('should reject duplicate payment when an existing payment is pending', async () => {
    provider.setScenario('timeout');
  
    await expect(
      service.processPayment('inv_001', 'pay_duplicate_001')
    ).rejects.toThrow('Payment provider timeout');
  
    await expect(
      service.processPayment('inv_001', 'pay_duplicate_002')
    ).rejects.toThrow(
      'Payment already exists for invoice: inv_001'
    );
  
    expect(provider.getCallCount()).toBe(1);
  });
  
  it('should reject duplicate payment after successful payment', async () => {
    await service.processPayment('inv_001', 'pay_duplicate_003');
  
    await expect(
      service.processPayment('inv_001', 'pay_duplicate_004')
    ).rejects.toThrow('Invoice is not payable: paid');
  
    expect(provider.getCallCount()).toBe(1);
  });

  it('should rollback payment updates when invoice update fails', async () => {
    const originalUpdateStatus = invoiceRepository.updateStatus;
  
    invoiceRepository.updateStatus = () => {
      throw new Error('Simulated database failure');
    };
  
    await expect(
      service.processPayment('inv_001', 'pay_rollback_001')
    ).rejects.toThrow('Simulated database failure');
  
    expect(
      paymentRepository.findById('pay_rollback_001')?.status
    ).toBe('pending');
  
    expect(
      invoiceRepository.findById('inv_001')?.status
    ).toBe('open');
  
    expect(
      subscriptionRepository.findById('sub_001')?.status
    ).toBe('trialing');
  
    invoiceRepository.updateStatus = originalUpdateStatus;
  });
});
