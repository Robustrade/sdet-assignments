
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
import { createApp } from '../../src/app';
import { WebhookRepository } from '../../src/repositories/WebhookRepository';
import { WebhookService } from '../../src/services/WebhookService';

describe('Subscription API', () => {
  let db: AppDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createDatabase();

    const customerRepository = new CustomerRepository(db);
    const subscriptionRepository = new SubscriptionRepository(db);
    const invoiceRepository = new InvoiceRepository(db);
    const paymentRepository = new PaymentRepository(db);

    const webhookRepository = new WebhookRepository(db);

const webhookService = new WebhookService(
  db,
  webhookRepository,
  invoiceRepository,
  paymentRepository,
  subscriptionRepository
);

    customerRepository.create(
      createCustomer('cust_001', 'test@example.com')
    );

    const service = new SubscriptionService(
      customerRepository,
      subscriptionRepository
    );

    const paymentService = new PaymentService(
      db,
      invoiceRepository,
      paymentRepository,
      subscriptionRepository,
      new MockPaymentProvider()
    );

    app = createApp(service, paymentService, webhookService);
  });

  afterEach(() => {
    db.close();
  });

  it('should return healthy status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should create a subscription', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        id: 'sub_001',
        customerId: 'cust_001',
        planId: 'premium'
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('sub_001');
    expect(response.body.status).toBe('trialing');
  });

  it('should reject subscription creation with missing fields', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'cust_001'
      });

    expect(response.status).toBe(400);
  });

  it('should return 404 for an unknown customer', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        id: 'sub_002',
        customerId: 'cust_unknown',
        planId: 'premium'
      });

    expect(response.status).toBe(404);
  });

  it('should retrieve an existing subscription', async () => {
    await request(app)
      .post('/subscriptions')
      .send({
        id: 'sub_003',
        customerId: 'cust_001',
        planId: 'premium'
      });

    const response = await request(app)
      .get('/subscriptions/sub_003');

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('sub_003');
  });

  it('should cancel an existing subscription', async () => {
    await request(app)
      .post('/subscriptions')
      .send({
        id: 'sub_004',
        customerId: 'cust_001',
        planId: 'premium'
      });

    const response = await request(app)
      .post('/subscriptions/sub_004/cancel');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('canceled');
  });

  it('should return 404 for an unknown subscription', async () => {
    const response = await request(app)
      .get('/subscriptions/unknown');

    expect(response.status).toBe(404);
  });
});
