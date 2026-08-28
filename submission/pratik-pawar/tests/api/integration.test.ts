import request from 'supertest';
import { app, createApp } from '../../src/app';
import { SubscriptionApiClient } from '../../src/api/clients/subscription-api-client';
import { MockPaymentProvider } from '../../src/infrastructure/payment/mock-payment-provider';

describe('subscription api', () => {
  it('creates a valid basic subscription and returns 201', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_001',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201)
      .expect('Content-Type', /json/);

    expect(response.body).toMatchObject({
      customerId: 'cust_001',
      plan: 'basic',
      status: 'trialing',
    });
    expect(response.body.id).toMatch(/^sub_/);
    expect(response.body.createdAt).toBeTruthy();
    expect(response.body.updatedAt).toBeTruthy();
  });

  it('creates a valid pro subscription and returns 201', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_002',
        plan: 'pro',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201)
      .expect('Content-Type', /json/);

    expect(response.body).toMatchObject({
      customerId: 'cust_002',
      plan: 'pro',
      status: 'active',
    });
  });

  it('returns 400 when customer_id is missing', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      message: expect.any(String),
    });
    expect(response.body.message).toContain('customer_id');
  });

  it('returns 400 when plan is missing', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_001',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(400);

    expect(response.body.message).toContain('plan');
  });

  it('returns 400 when payment_method_id is missing', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_001',
        plan: 'basic',
      })
      .expect(400);

    expect(response.body.message).toContain('payment_method_id');
  });

  it('returns 400 when customer_id is empty', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: '',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(400);

    expect(response.body.message).toContain('customer_id');
  });

  it('returns a client error for unknown plans rather than 500', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_001',
        plan: 'enterprise',
        payment_method_id: 'pm_test_visa_4242',
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body).toMatchObject({
      message: expect.any(String),
    });
    expect(response.body.message).toMatch(/Unknown plan/i);
  });

  it('returns an existing subscription by id', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_003',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201);

    const response = await request(app).get(`/subscriptions/${created.body.id}`).expect(200);

    expect(response.body).toEqual(created.body);
  });

  it('returns 404 for an unknown subscription id', async () => {
    const response = await request(app).get('/subscriptions/missing-sub').expect(404);

    expect(response.body).toMatchObject({
      message: 'Subscription not found',
    });
  });

  it('cancels an existing subscription and returns the canceled state', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_004',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201);

    const response = await request(app).post(`/subscriptions/${created.body.id}/cancel`).expect(200);

    expect(response.body.status).toBe('canceled');
    const afterCancel = await request(app).get(`/subscriptions/${created.body.id}`).expect(200);
    expect(afterCancel.body.status).toBe('canceled');
  });

  it('returns 404 when canceling an unknown subscription', async () => {
    const response = await request(app).post('/subscriptions/missing-sub/cancel').expect(404);

    expect(response.body.message).toBe('Subscription not found');
  });

  it('returns 409 when canceling an already canceled subscription', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_005',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201);

    await request(app).post(`/subscriptions/${created.body.id}/cancel`).expect(200);
    const response = await request(app).post(`/subscriptions/${created.body.id}/cancel`).expect(409);

    expect(response.body.message).toContain('already canceled');
  });

  it('returns JSON error payloads with a useful message', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_001',
        plan: 'enterprise',
        payment_method_id: 'pm_test_visa_4242',
      });

    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toHaveProperty('message');
    expect(typeof response.body.message).toBe('string');
    expect(response.body.message.length).toBeGreaterThan(0);
  });

  it('renders client create and getById requests correctly', async () => {
    const originalFetch = global.fetch;
    const calls: Array<{ input: string; init?: RequestInit }> = [];

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });

      return new Response(
        JSON.stringify({
          id: 'sub_123',
          customerId: 'cust_010',
          plan: 'basic',
          status: 'trialing',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const client = new SubscriptionApiClient('http://example.com');
      const created = await client.create({
        customer_id: 'cust_010',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      });

      expect(created).toMatchObject({
        customerId: 'cust_010',
        status: 'trialing',
      });
      expect(calls[0].input).toContain('/subscriptions');
      expect(calls[0].init?.method).toBe('POST');
      expect(calls[0].init?.headers).toMatchObject({
        'Content-Type': 'application/json',
      });

      global.fetch = jest.fn(async () =>
        new Response(JSON.stringify({ id: 'sub_123', customerId: 'cust_010', plan: 'basic', status: 'trialing' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as typeof fetch;

      const fetched = await client.getById('sub_123');
      expect(fetched).toMatchObject({ id: 'sub_123' });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('subscription billing integration flow', () => {
  it('keeps API-visible state and persistence aligned across multiple successful payments', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();

    const created = await request(testApp)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_integration_multi',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201);

    expect(created.body.status).toBe('trialing');
    expect(testApp.locals.subscriptionRepository.findById(created.body.id)?.status).toBe('trialing');

    const firstPayment = provider.createWebhookPayload({
      event_id: 'evt_integration_payment_001',
      type: 'payment.succeeded',
      subscription_id: created.body.id,
      invoice_id: 'inv_integration_payment_001',
      amount: 2900,
      currency: 'USD',
    });

    const secondPayment = provider.createWebhookPayload({
      event_id: 'evt_integration_payment_002',
      type: 'payment.succeeded',
      subscription_id: created.body.id,
      invoice_id: 'inv_integration_payment_002',
      amount: 2900,
      currency: 'USD',
    });

    await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', provider.signWebhookPayload(firstPayment))
      .send(firstPayment)
      .expect(200);

    await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', provider.signWebhookPayload(secondPayment))
      .send(secondPayment)
      .expect(200);

    const fetched = await request(testApp).get(`/subscriptions/${created.body.id}`).expect(200);

    expect(fetched.body.status).toBe('active');
    expect(testApp.locals.subscriptionRepository.findById(created.body.id)?.status).toBe('active');
    expect(testApp.locals.invoiceRepository.findById('inv_integration_payment_001')).toMatchObject({
      amount: 2900,
      status: 'paid',
    });
    expect(testApp.locals.invoiceRepository.findById('inv_integration_payment_002')).toMatchObject({
      amount: 2900,
      status: 'paid',
    });
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_integration_payment_001')).toMatchObject({
      invoiceId: 'inv_integration_payment_001',
    });
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_integration_payment_002')).toMatchObject({
      invoiceId: 'inv_integration_payment_002',
    });
  });

  it('rejects a signed wrong-amount payment without mutating subscription, invoice, or event state', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();

    const created = await request(testApp)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_integration_wrong_amount',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201);

    const wrongAmountPayment = provider.createWebhookPayload({
      event_id: 'evt_integration_wrong_amount',
      type: 'payment.succeeded',
      subscription_id: created.body.id,
      invoice_id: 'inv_integration_wrong_amount',
      amount: 4900,
      currency: 'USD',
    });

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', provider.signWebhookPayload(wrongAmountPayment))
      .send(wrongAmountPayment)
      .expect(400);

    expect(response.body.message).toMatch(/does not match basic plan price/i);
    expect(testApp.locals.subscriptionRepository.findById(created.body.id)?.status).toBe('trialing');
    expect(testApp.locals.invoiceRepository.findById('inv_integration_wrong_amount')).toBeUndefined();
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_integration_wrong_amount')).toBeUndefined();
  });
});
