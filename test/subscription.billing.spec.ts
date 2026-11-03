import type { APIRequestContext } from '@playwright/test';

const nodeCrypto = require('crypto');
const { test, expect } = require('@playwright/test');
const {
  SubscriptionService: SubscriptionServiceClass,
  SubscriptionRepository: SubscriptionRepositoryClass,
  SubscriptionStateMachine: SubscriptionStateMachineClass,
  PaymentProviderMock: PaymentProviderMockClass,
} = require('../src/billing/SubscriptionService');

const WEBHOOK_SECRET = 'billing-secret';

function sign(rawBody: string) {
  return nodeCrypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

async function postWebhook(request: APIRequestContext, payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  return request.post('/webhooks/payment-provider', {
    headers: {
      'Content-Type': 'application/json',
      'X-Provider-Signature': sign(raw),
    },
    data: raw,
  });
}

test.describe('Subscription & billing workflow', () => {
  test('creates a subscription and exposes the persisted state through the API', async ({ request }: { request: APIRequestContext }) => {
    const createResponse = await request.post('/subscriptions', {
      data: {
        customer_id: 'cust_001',
        plan: 'pro',
        payment_method_id: 'pm_test_visa_4242',
      },
    });

    expect(createResponse.status()).toBe(201);
    const createdBody = await createResponse.json();
    expect(createdBody.ok).toBeTruthy();
    expect(createdBody.subscription.plan).toBe('pro');
    expect(createdBody.subscription.state).toBe('active');

    const fetchResponse = await request.get(`/subscriptions/${createdBody.subscription.id}`);
    expect(fetchResponse.status()).toBe(200);
    const fetched = await fetchResponse.json();
    expect(fetched.subscription.state).toBe('active');
    expect(fetched.subscription.customer_id).toBe('cust_001');
  });

  test('rejects malformed payloads and invalid webhook signatures', async ({ request }: { request: APIRequestContext }) => {
    const invalidPlan = await request.post('/subscriptions', {
      data: {
        customer_id: 'cust_invalid',
        plan: 'enterprise',
        payment_method_id: 'pm_unsupported',
      },
    });
    expect(invalidPlan.status()).toBe(400);

    const missingCustomer = await request.post('/subscriptions', {
      data: {
        plan: 'basic',
        payment_method_id: 'pm_missing_customer',
      },
    });
    expect(missingCustomer.status()).toBe(400);

    const payload = {
      event_id: 'evt_invalid_sig',
      type: 'payment.succeeded',
      subscription_id: 'sub_missing_123',
      invoice_id: 'inv_invalid_sig',
      amount: 4900,
      currency: 'USD',
    };

    const invalidSignature = await request.post('/webhooks/payment-provider', {
      data: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Signature': 'not-valid',
      },
    });
    expect(invalidSignature.status()).toBe(401);

    const malformedPayload = await fetch('http://127.0.0.1:3000/webhooks/payment-provider', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Signature': sign('{bad-json'),
      },
      body: '{bad-json',
    });
    expect(malformedPayload.status).toBe(400);
  });

  test('enforces the subscription lifecycle and ignores duplicate webhooks', async ({ request }: { request: APIRequestContext }) => {
    const createResponse = await request.post('/subscriptions', {
      data: {
        customer_id: 'cust_003',
        plan: 'basic',
        payment_method_id: 'pm_trial_123',
      },
    });
    const createBody = await createResponse.json();
    const subscriptionId = createBody.subscription.id;

    expect(createBody.subscription.state).toBe('trialing');

    const successEvent = {
      event_id: 'evt_cycle_1',
      type: 'payment.succeeded',
      subscription_id: subscriptionId,
      invoice_id: 'inv_cycle_1',
      amount: 1000,
      currency: 'USD',
    };

    const successResponse = await postWebhook(request, successEvent);
    expect(successResponse.status()).toBe(200);
    expect((await successResponse.json()).ok).toBeTruthy();

    const afterSuccess = await request.get(`/subscriptions/${subscriptionId}`);
    expect((await afterSuccess.json()).subscription.state).toBe('active');

    const duplicateResponse = await postWebhook(request, successEvent);
    const duplicateBody = await duplicateResponse.json();
    expect(duplicateBody.ignored).toBeTruthy();

    const failedEvent = {
      event_id: 'evt_cycle_2',
      type: 'payment.failed',
      subscription_id: subscriptionId,
      invoice_id: 'inv_cycle_2',
      amount: 1000,
      currency: 'USD',
    };

    const failedResponse = await postWebhook(request, failedEvent);
    expect(failedResponse.status()).toBe(200);
    expect((await failedResponse.json()).ok).toBeTruthy();

    const afterFailure = await request.get(`/subscriptions/${subscriptionId}`);
    expect((await afterFailure.json()).subscription.state).toBe('past_due');

    const restoreEvent = {
      event_id: 'evt_cycle_3',
      type: 'payment.succeeded',
      subscription_id: subscriptionId,
      invoice_id: 'inv_cycle_3',
      amount: 1000,
      currency: 'USD',
    };

    const restoreResponse = await postWebhook(request, restoreEvent);
    expect(restoreResponse.status()).toBe(200);
    expect((await restoreResponse.json()).ok).toBeTruthy();

    const cancelResponse = await request.post(`/subscriptions/${subscriptionId}/cancel`);
    expect(cancelResponse.status()).toBe(200);
    const canceled = await cancelResponse.json();
    expect(canceled.subscription.state).toBe('canceled');

    const blockedWebhook = await postWebhook(request, {
      event_id: 'evt_cycle_4',
      type: 'payment.succeeded',
      subscription_id: subscriptionId,
      invoice_id: 'inv_cycle_4',
      amount: 1000,
      currency: 'USD',
    });
    const blockedBody = await blockedWebhook.json();
    expect(blockedBody.ignored).toBeTruthy();
  });

  test('verifies the payment provider is mocked and called with the expected arguments', async () => {
    const provider = new PaymentProviderMockClass([{ ok: true }]);
    const repository = new SubscriptionRepositoryClass();
    const service = new SubscriptionServiceClass({
      repository,
      paymentProvider: provider,
      stateMachine: new SubscriptionStateMachineClass(),
    });

    const subscription = await service.createSubscription({
      customer_id: 'cust_mock_success',
      plan: 'pro',
      payment_method_id: 'pm_mock_success',
    });

    expect(subscription.state).toBe('active');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].amount).toBe(4900);
    expect(provider.calls[0].currency).toBe('USD');

    const failingProvider = new PaymentProviderMockClass([{ ok: false }]);
    const failingService = new SubscriptionServiceClass({
      repository: new SubscriptionRepositoryClass(),
      paymentProvider: failingProvider,
      stateMachine: new SubscriptionStateMachineClass(),
    });

    const failedSubscription = await failingService.createSubscription({
      customer_id: 'cust_mock_failure',
      plan: 'pro',
      payment_method_id: 'pm_mock_failure',
    });

    expect(failedSubscription.state).toBe('past_due');
    expect(failingProvider.calls[0].paymentMethodId).toBe('pm_mock_failure');
  });
});
