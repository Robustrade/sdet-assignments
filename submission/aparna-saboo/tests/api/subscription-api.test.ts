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

  it('processes a valid payment.succeeded webhook and persists the invoice and event', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();
    const subscriptionApp = testApp.locals.subscriptionService;
    const created = await subscriptionApp.createSubscription({
      customerId: 'cust_webhook',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const payload = provider.createWebhookPayload({
      event_id: 'evt_webhook_success',
      type: 'payment.succeeded',
      subscription_id: created.id,
      invoice_id: 'inv_webhook_success',
      amount: 4900,
      currency: 'USD',
    });
    const signature = provider.signWebhookPayload(payload);

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(payload)
      .expect(200);

    expect(response.body).toEqual({ processed: true, duplicate: false });
    expect(testApp.locals.subscriptionRepository.findById(created.id)?.status).toBe('active');
    expect(testApp.locals.invoiceRepository.findById('inv_webhook_success')?.status).toBe('paid');
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_webhook_success')).toMatchObject({
      eventId: 'evt_webhook_success',
      type: 'payment.succeeded',
    });
  });

  it('returns 200 for a duplicate webhook and does not duplicate side effects', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();
    const subscriptionApp = testApp.locals.subscriptionService;
    const created = await subscriptionApp.createSubscription({
      customerId: 'cust_duplicate',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const payload = provider.createWebhookPayload({
      event_id: 'evt_duplicate_test',
      subscription_id: created.id,
      invoice_id: 'inv_duplicate',
    });
    const signature = provider.signWebhookPayload(payload);

    const first = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(payload)
      .expect(200);

    const second = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(payload)
      .expect(200);

    expect(first.body).toEqual({ processed: true, duplicate: false });
    expect(second.body).toEqual({ processed: false, duplicate: true });
    expect(testApp.locals.subscriptionRepository.findById(created.id)?.status).toBe('active');
    expect(testApp.locals.invoiceRepository.findById('inv_duplicate')?.status).toBe('paid');
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_duplicate_test')).toMatchObject({
      eventId: 'evt_duplicate_test',
    });
  });

  it('returns 400 for an invalid signature and does not persist side effects', async () => {
    const testApp = createApp();
    const payload = new MockPaymentProvider().createWebhookPayload({
      event_id: 'evt_bad_sig',
      subscription_id: 'sub_bad_sig',
      invoice_id: 'inv_bad_sig',
    });

    const subscriptionApp = testApp.locals.subscriptionService;
    await subscriptionApp.createSubscription({
      customerId: 'cust_bad_sig',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', 'sha256=invalid')
      .send(payload)
      .expect(400);

    expect(response.body.message).toMatch(/Invalid signature|signature/i);
    expect(testApp.locals.invoiceRepository.findById('inv_bad_sig')).toBeUndefined();
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_bad_sig')).toBeUndefined();
  });

  it('returns 400 when the signature header is missing', async () => {
    const testApp = createApp();
    const payload = new MockPaymentProvider().createWebhookPayload({
      event_id: 'evt_missing_sig',
      subscription_id: 'sub_missing_sig',
      invoice_id: 'inv_missing_sig',
    });

    const subscriptionApp = testApp.locals.subscriptionService;
    await subscriptionApp.createSubscription({
      customerId: 'cust_missing_sig',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .send(payload)
      .expect(400);

    expect(response.body.message).toMatch(/signature/i);
    expect(testApp.locals.invoiceRepository.findById('inv_missing_sig')).toBeUndefined();
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_missing_sig')).toBeUndefined();
  });

  it('returns 400 for malformed webhook payloads and does not persist side effects', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();
    const validPayload = provider.createWebhookPayload({
      event_id: 'evt_bad_payload',
      subscription_id: 'sub_bad_payload',
      invoice_id: 'inv_bad_payload',
    });
    const signature = provider.signWebhookPayload(validPayload);

    await testApp.locals.subscriptionService.createSubscription({
      customerId: 'cust_bad_payload',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const missingEventId = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send({ ...validPayload, event_id: undefined })
      .expect(400);
    expect(missingEventId.body.message).toMatch(/event_id/i);

    const invalidType = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send({ ...validPayload, type: 'payment.cancelled' })
      .expect(400);
    expect(invalidType.body.message).toMatch(/type/i);

    const invalidCurrency = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send({ ...validPayload, currency: 'CAD' })
      .expect(400);
    expect(invalidCurrency.body.message).toMatch(/currency/i);

    const invalidAmount = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send({ ...validPayload, amount: Number.NaN })
      .expect(400);
    expect(invalidAmount.body.message).toMatch(/amount/i);

    expect(testApp.locals.invoiceRepository.findById('inv_bad_payload')).toBeUndefined();
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_bad_payload')).toBeUndefined();
  });

  it('returns 404 for a validly signed webhook targeting an unknown subscription', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();
    const payload = provider.createWebhookPayload({
      event_id: 'evt_unknown_subscription',
      subscription_id: 'sub_missing',
      invoice_id: 'inv_unknown_subscription',
    });
    const signature = provider.signWebhookPayload(payload);

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(payload)
      .expect(404);

    expect(response.body.message).toMatch(/Subscription not found/i);
    expect(testApp.locals.invoiceRepository.findById('inv_unknown_subscription')).toBeUndefined();
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_unknown_subscription')).toBeUndefined();
  });

  it('returns 200 for a failed payment webhook and persists the failed invoice and event', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();
    const subscriptionApp = testApp.locals.subscriptionService;
    const created = await subscriptionApp.createSubscription({
      customerId: 'cust_failed_payment',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const payload = provider.createWebhookPayload({
      event_id: 'evt_failed_payment',
      type: 'payment.failed',
      subscription_id: created.id,
      invoice_id: 'inv_failed_payment',
    });
    const signature = provider.signWebhookPayload(payload);

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(payload)
      .expect(200);

    expect(response.body).toEqual({ processed: true, duplicate: false });
    expect(testApp.locals.subscriptionRepository.findById(created.id)?.status).toBe('past_due');
    expect(testApp.locals.invoiceRepository.findById('inv_failed_payment')?.status).toBe('failed');
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_failed_payment')).toMatchObject({
      eventId: 'evt_failed_payment',
      type: 'payment.failed',
    });
  });

  it('returns 200 for a refunded payment webhook and leaves the subscription state unchanged', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();
    const subscriptionApp = testApp.locals.subscriptionService;
    const created = await subscriptionApp.createSubscription({
      customerId: 'cust_refunded_payment',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const payload = provider.createWebhookPayload({
      event_id: 'evt_refunded_payment',
      type: 'payment.refunded',
      subscription_id: created.id,
      invoice_id: 'inv_refunded_payment',
    });
    const signature = provider.signWebhookPayload(payload);

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(payload)
      .expect(200);

    expect(response.body).toEqual({ processed: true, duplicate: false });
    expect(testApp.locals.invoiceRepository.findById('inv_refunded_payment')?.status).toBe('refunded');
    expect(testApp.locals.subscriptionRepository.findById(created.id)?.status).toBe('active');
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_refunded_payment')).toMatchObject({
      eventId: 'evt_refunded_payment',
      type: 'payment.refunded',
    });
  });

  it('does not reactivate a canceled subscription when a valid payment.succeeded webhook arrives', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();
    const subscriptionApp = testApp.locals.subscriptionService;
    const created = await subscriptionApp.createSubscription({
      customerId: 'cust_canceled_webook',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    await subscriptionApp.cancelSubscription(created.id);

    const payload = provider.createWebhookPayload({
      event_id: 'evt_canceled_subscription',
      type: 'payment.succeeded',
      subscription_id: created.id,
      invoice_id: 'inv_canceled_subscription',
    });
    const signature = provider.signWebhookPayload(payload);

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(payload)
      .expect(200);

    expect(response.body).toEqual({ processed: true, duplicate: false });
    expect(testApp.locals.subscriptionRepository.findById(created.id)?.status).toBe('canceled');
    expect(testApp.locals.invoiceRepository.findById('inv_canceled_subscription')?.status).toBe('paid');
  });

  it('does not regress an active subscription when a payment.failed webhook arrives after a successful invoice', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();
    const subscriptionApp = testApp.locals.subscriptionService;
    const created = await subscriptionApp.createSubscription({
      customerId: 'cust_out_of_order',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const successPayload = provider.createWebhookPayload({
      event_id: 'evt_success_order',
      type: 'payment.succeeded',
      subscription_id: created.id,
      invoice_id: 'inv_ordered',
    });
    const successSignature = provider.signWebhookPayload(successPayload);

    await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', successSignature)
      .send(successPayload)
      .expect(200);

    const failedPayload = provider.createWebhookPayload({
      event_id: 'evt_failed_after_success',
      type: 'payment.failed',
      subscription_id: created.id,
      invoice_id: 'inv_ordered',
    });
    const failedSignature = provider.signWebhookPayload(failedPayload);

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', failedSignature)
      .send(failedPayload)
      .expect(200);

    expect(response.body).toEqual({ processed: true, duplicate: false });
    expect(testApp.locals.invoiceRepository.findById('inv_ordered')?.status).toBe('paid');
    expect(testApp.locals.subscriptionRepository.findById(created.id)?.status).toBe('active');
  });
});
