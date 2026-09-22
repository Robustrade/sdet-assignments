import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import request from 'supertest';

import { SubscriptionBuilder } from './builders/subscription-builder';
import { WebhookBuilder } from './builders/webhook-builder';
import { createTestEnvironment, type TestEnvironment } from './fixtures/test-environment';
import { generateWebhookSignature } from '../src/webhook-signature';

describe('Subscription API', () => {
  const webhookSecret = 'test_webhook_secret';

  let db: TestEnvironment['db'];
  let app: TestEnvironment['app'];
  let service: TestEnvironment['service'];
  let subscriptionRepository: TestEnvironment['subscriptionRepository'];
  let paymentRepository: TestEnvironment['paymentRepository'];
  let webhookRepository: TestEnvironment['webhookRepository'];
  let paymentProvider: TestEnvironment['paymentProvider'];

  beforeEach(() => {
    ({
      db,
      app,
      service,
      subscriptionRepository,
      paymentRepository,
      webhookRepository,
      paymentProvider,
    } = createTestEnvironment(webhookSecret));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it.each([
    { plan: 'basic', trialEndsAt: '2026-10-02T12:00:00.000Z' },
    { plan: 'pro', trialEndsAt: '2026-10-09T12:00:00.000Z' },
  ])('creates and retrieves a $plan subscription with its trial end date', async ({ plan, trialEndsAt }) => {
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-09-25T12:00:00.000Z'),
    );

    const response = await request(app)
      .post('/subscriptions')
      .send(new SubscriptionBuilder().withPlan(plan).build());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ plan, state: 'trialing', trialEndsAt });
    expect(subscriptionRepository.findById('sub_001')).toEqual(response.body);

    const retrieved = await request(app).get('/subscriptions/sub_001');

    expect(retrieved.status).toBe(200);
    expect(retrieved.body).toEqual(response.body);
    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('creates a subscription', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send(new SubscriptionBuilder().build());

    expect(response.status).toBe(201);

    expect(response.body).toMatchObject({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      state: 'trialing',
      paymentMethodId: 'pm_001',
    });

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('trialing');
  });

  it('rejects subscription creation when required fields are missing', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'cust_001',
        plan: 'pro',
      });

    expect(response.status).toBe(400);

    expect(response.body).toEqual({
      error: 'Missing required fields',
    });

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('rejects an invalid plan', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        id: 'sub_001',
        customerId: 'cust_001',
        plan: 'premium-super-plan',
        paymentMethodId: 'pm_001',
      });

    expect(response.status).toBe(400);

    expect(response.body).toEqual({
      error: 'Invalid plan',
    });

    expect(
      subscriptionRepository.findById('sub_001'),
    ).toBeUndefined();

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('retrieves an existing subscription', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const response = await request(app)
      .get('/subscriptions/sub_001');

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      state: 'trialing',
    });
  });

  it('returns 404 for unknown subscription', async () => {
    const response = await request(app)
      .get('/subscriptions/does-not-exist');

    expect(response.status).toBe(404);

    expect(response.body).toEqual({
      error: 'Subscription not found',
    });
  });

  it('cancels a subscription', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const response = await request(app)
      .post('/subscriptions/sub_001/cancel');

    expect(response.status).toBe(200);

    expect(response.body.state).toBe('canceled');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('canceled');

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('rejects canceling an already canceled subscription', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    await service.cancelSubscription('sub_001');

    const response = await request(app)
      .post('/subscriptions/sub_001/cancel');

    expect(response.status).toBe(409);

    expect(response.body).toEqual({
      error: 'Subscription cannot be canceled',
    });

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('processes a payment success webhook through the API', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const webhook = new WebhookBuilder().paymentSucceeded().build();

    const signature =
      generateWebhookSignature(webhook, webhookSecret);

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook);

    expect(response.status).toBe(200);
    expect(response.body.state).toBe('active');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('active');

    const payments =
      paymentRepository.findBySubscriptionId(
        'sub_001',
      );

    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('success');
    expect(payments[0]?.amount).toBe(4900);

    expect(
      webhookRepository.exists('evt_001'),
    ).toBe(true);

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('processes a payment failed webhook through the API', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const webhook = new WebhookBuilder().paymentFailed().build();

    const signature =
      generateWebhookSignature(webhook, webhookSecret);

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook);

    expect(response.status).toBe(200);
    expect(response.body.state).toBe('past_due');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('past_due');

    const payments =
      paymentRepository.findBySubscriptionId(
        'sub_001',
      );

    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('failed');

    expect(
      webhookRepository.exists('evt_001'),
    ).toBe(true);

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('does not duplicate side effects when webhook is replayed', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const webhook = new WebhookBuilder().paymentSucceeded().build();

    const signature =
      generateWebhookSignature(webhook, webhookSecret);

    await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook);

    await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook);

    const payments =
      paymentRepository.findBySubscriptionId(
        'sub_001',
      );

    expect(payments).toHaveLength(1);

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('active');

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('does not regress subscription when failed webhook arrives after success for same invoice', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const successWebhook = new WebhookBuilder()
      .withEventId('evt_success')
      .paymentSucceeded()
      .build();

    const success = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature',
        generateWebhookSignature(successWebhook, webhookSecret))
      .send(successWebhook);

    expect(success.status).toBe(200);
    expect(success.body.state).toBe('active');

    const failureWebhook = {
      ...successWebhook,
      eventId: 'evt_failure',
      type: 'payment.failed',
    };

    const failure = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature',
        generateWebhookSignature(failureWebhook, webhookSecret))
      .send(failureWebhook);

    expect(failure.status).toBe(200);
    expect(failure.body.state).toBe('active');
    expect(
      subscriptionRepository.findById('sub_001')?.state,
    ).toBe('active');

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      id: 'inv_001',
      status: 'success',
    });

    expect(webhookRepository.exists('evt_success')).toBe(true);
    expect(webhookRepository.exists('evt_failure')).toBe(true);
    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('rejects webhook with invalid signature', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const webhook = new WebhookBuilder().paymentSucceeded().build();

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set(
        'X-Provider-Signature',
        'this-is-not-a-valid-signature',
      )
      .send(webhook);

    expect(response.status).toBe(401);

    expect(response.body).toEqual({
      error: 'Invalid webhook signature',
    });

    expect(
      subscriptionRepository.findById('sub_001')
        ?.state,
    ).toBe('trialing');

    expect(
      paymentRepository.findBySubscriptionId(
        'sub_001',
      ),
    ).toHaveLength(0);

    expect(
      webhookRepository.exists('evt_001'),
    ).toBe(false);
  });

  it('rejects webhook without signature', async () => {
    const webhook = new WebhookBuilder().paymentSucceeded().build();

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .send(webhook);

    expect(response.status).toBe(401);

    expect(response.body).toEqual({
      error: 'Missing webhook signature',
    });

    expect(
      webhookRepository.exists('evt_001'),
    ).toBe(false);

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('rejects malformed webhook payload', async () => {
    const webhook = {
      eventId: 'evt_001',
      type: 'payment.succeeded',
    };

    const signature =
      generateWebhookSignature(webhook, webhookSecret);

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook);

    expect(response.status).toBe(400);

    expect(response.body).toEqual({
      error: 'Invalid webhook payload',
    });

    expect(
      webhookRepository.exists('evt_001'),
    ).toBe(false);
  });
});
