
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository';
import { PaymentRepository } from '../../src/repositories/PaymentRepository';
import { SubscriptionService } from '../../src/services/SubscriptionService';
import { PaymentService } from '../../src/services/PaymentService';
import { MockPaymentProvider } from '../../src/providers/MockPaymentProvider';
import { createCustomer } from '../../src/models/Customer';
import { createSubscription } from '../../src/models/Subscription';
import { createInvoice } from '../../src/models/Invoice';
import { createApp } from '../../src/app';
import { WebhookRepository } from '../../src/repositories/WebhookRepository';
import { WebhookService } from '../../src/services/WebhookService';

describe('Payment API', () => {
  let db: AppDatabase;
  let app: ReturnType<typeof createApp>;
  let invoiceRepository: InvoiceRepository;
  let subscriptionRepository: SubscriptionRepository;
  let provider: MockPaymentProvider;

  beforeEach(async () => {
    db = await createDatabase();

    const customerRepository = new CustomerRepository(db);
    subscriptionRepository = new SubscriptionRepository(db);
    invoiceRepository = new InvoiceRepository(db);

    const paymentRepository = new PaymentRepository(db);
    const webhookRepository = new WebhookRepository(db);

const webhookService = new WebhookService(
  db,
  webhookRepository,
  invoiceRepository,
  paymentRepository,
  subscriptionRepository
);
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

    const subscriptionService = new SubscriptionService(
      customerRepository,
      subscriptionRepository
    );

    const paymentService = new PaymentService(
      db,
      invoiceRepository,
      paymentRepository,
      subscriptionRepository,
      provider
    );

    app = createApp(subscriptionService, paymentService, webhookService);
  });

  afterEach(() => {
    db.close();
  });

  it('should process a successful payment through API', async () => {
    const response = await request(app)
      .post('/invoices/inv_001/payments')
      .send({ paymentId: 'pay_api_001' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('succeeded');

    expect(invoiceRepository.findById('inv_001')?.status).toBe('paid');
    expect(subscriptionRepository.findById('sub_001')?.status).toBe('active');
  });

  it('should reject a payment request without paymentId', async () => {
    const response = await request(app)
      .post('/invoices/inv_001/payments')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('paymentId is required');
  });

  it('should return 404 when invoice does not exist', async () => {
    const response = await request(app)
      .post('/invoices/inv_unknown/payments')
      .send({ paymentId: 'pay_api_002' });

    expect(response.status).toBe(404);
  });

  it('should return failed payment when provider declines', async () => {
    provider.setScenario('decline');

    const response = await request(app)
      .post('/invoices/inv_001/payments')
      .send({ paymentId: 'pay_api_003' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('failed');

    expect(invoiceRepository.findById('inv_001')?.status).toBe('open');
    expect(subscriptionRepository.findById('sub_001')?.status).toBe('trialing');
  });

  it('should not charge an invoice twice after successful payment', async () => {
    const firstResponse = await request(app)
      .post('/invoices/inv_001/payments')
      .send({ paymentId: 'pay_api_004' });

    const secondResponse = await request(app)
      .post('/invoices/inv_001/payments')
      .send({ paymentId: 'pay_api_005' });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(400);
    expect(provider.getCallCount()).toBe(1);
  });
});
