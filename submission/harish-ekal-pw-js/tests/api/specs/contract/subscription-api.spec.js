const { test, expect } = require('@playwright/test');
const { boot } = require('../../support/boot');
const {
  SubscriptionRequestBuilder,
} = require('../../pom/builders/subscriptionRequestBuilder');
const {
  WebhookEventBuilder,
} = require('../../pom/builders/webhookEventBuilder');
const {
  expectSubscriptionStatus,
  expectSingleInvoice,
} = require('../../pom/assertions/persistenceAsserts');

test('creates pro subscription and charges once with persisted success', async () => {
  const ctx = await boot();

  const response = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('pro').build(),
  );
  expect(response.status()).toBe(201);
  const body = await response.json();

  expect(body.status).toBe('active');
  expect(ctx.paymentProvider.calls).toHaveLength(1);
  expect(ctx.paymentProvider.calls[0]).toMatchObject({
    amount: 4900,
    customerId: 'cust_001',
    paymentMethodId: 'pm_test_visa_4242',
  });

  expectSingleInvoice(ctx.repos, `inv_create_${body.id}`, 'succeeded');
  expectSubscriptionStatus(ctx.repos, body.id, 'active');

  await ctx.close();
});

test('rejects invalid plan without persistence side effects or provider calls', async () => {
  const ctx = await boot();

  const response = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('enterprise').build(),
  );
  expect(response.status()).toBe(400);

  expect(ctx.paymentProvider.calls).toHaveLength(0);
  expect(ctx.repos.subscriptionRepo.all()).toHaveLength(0);
  expect(ctx.repos.invoiceRepo.all()).toHaveLength(0);

  await ctx.close();
});

test('rejects unknown customer and does not call provider', async () => {
  const ctx = await boot();

  const response = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withCustomer('cust_missing').build(),
  );
  expect(response.status()).toBe(404);
  expect(ctx.paymentProvider.calls).toHaveLength(0);
  expect(ctx.repos.subscriptionRepo.all()).toHaveLength(0);

  await ctx.close();
});

test('missing webhook signature is rejected', async () => {
  const ctx = await boot();

  const subRes = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('basic').build(),
  );
  const sub = await subRes.json();

  const payload = new WebhookEventBuilder()
    .withEventId('evt_no_sig')
    .withSubscriptionId(sub.id)
    .build();

  const response = await ctx.api.request.post('/webhooks/payment-provider', {
    data: payload,
  });
  expect(response.status()).toBe(401);
  expect(ctx.repos.webhookRepo.all()).toHaveLength(0);

  await ctx.close();
});

test('invalid webhook payload is rejected', async () => {
  const ctx = await boot();

  const response = await ctx.api.sendWebhook(
    { event_id: 'evt_invalid', type: 'payment.succeeded' },
    ctx.webhookSecret,
  );
  expect(response.status()).toBe(400);
  expect(ctx.repos.webhookRepo.all()).toHaveLength(0);

  await ctx.close();
});
