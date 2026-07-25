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

test('trialing transitions to past_due on payment.failed webhook', async () => {
  const ctx = await boot();

  const subRes = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('basic').build(),
  );
  const sub = await subRes.json();
  expect(sub.status).toBe('trialing');

  const payload = new WebhookEventBuilder()
    .withEventId('evt_fail_1')
    .withType('payment.failed')
    .withSubscriptionId(sub.id)
    .withInvoiceId('inv_trial_1')
    .withAmount(1900)
    .build();

  const webhookRes = await ctx.api.sendWebhook(payload, ctx.webhookSecret);
  expect(webhookRes.status()).toBe(200);

  expectSubscriptionStatus(ctx.repos, sub.id, 'past_due');
  expectSingleInvoice(ctx.repos, 'inv_trial_1', 'failed');

  await ctx.close();
});

test('past_due transitions to active on payment.succeeded webhook', async () => {
  const ctx = await boot();

  const subRes = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('basic').build(),
  );
  const sub = await subRes.json();

  const fail = new WebhookEventBuilder()
    .withEventId('evt_pd_fail')
    .withType('payment.failed')
    .withSubscriptionId(sub.id)
    .withInvoiceId('inv_pd_1')
    .withAmount(1900)
    .build();
  await ctx.api.sendWebhook(fail, ctx.webhookSecret);

  const success = new WebhookEventBuilder()
    .withEventId('evt_pd_ok')
    .withType('payment.succeeded')
    .withSubscriptionId(sub.id)
    .withInvoiceId('inv_pd_2')
    .withAmount(1900)
    .build();

  const successRes = await ctx.api.sendWebhook(success, ctx.webhookSecret);
  expect(successRes.status()).toBe(200);
  expectSubscriptionStatus(ctx.repos, sub.id, 'active');
  expectSingleInvoice(ctx.repos, 'inv_pd_2', 'succeeded');

  await ctx.close();
});

test('canceled subscription cannot be reactivated by webhook', async () => {
  const ctx = await boot();

  const subRes = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('basic').build(),
  );
  const sub = await subRes.json();

  const cancelRes = await ctx.api.cancelSubscription(sub.id);
  expect(cancelRes.status()).toBe(200);

  const payload = new WebhookEventBuilder()
    .withEventId('evt_after_cancel')
    .withType('payment.succeeded')
    .withSubscriptionId(sub.id)
    .withInvoiceId('inv_after_cancel')
    .withAmount(1900)
    .build();

  const webhookRes = await ctx.api.sendWebhook(payload, ctx.webhookSecret);
  expect(webhookRes.status()).toBe(200);

  expectSubscriptionStatus(ctx.repos, sub.id, 'canceled');
  expect(
    ctx.repos.invoiceRepo.findByInvoiceId('inv_after_cancel'),
  ).toHaveLength(0);

  await ctx.close();
});

test('canceling already canceled subscription returns conflict', async () => {
  const ctx = await boot();

  const subRes = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('basic').build(),
  );
  const sub = await subRes.json();

  const firstCancel = await ctx.api.cancelSubscription(sub.id);
  expect(firstCancel.status()).toBe(200);

  const secondCancel = await ctx.api.cancelSubscription(sub.id);
  expect(secondCancel.status()).toBe(409);
  expectSubscriptionStatus(ctx.repos, sub.id, 'canceled');

  await ctx.close();
});

test('payment provider decline leads to past_due for immediate-charge plan', async () => {
  const ctx = await boot();
  ctx.paymentProvider.setDefaultOutcome('decline');

  const res = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('pro').build(),
  );
  expect(res.status()).toBe(201);
  const sub = await res.json();

  expect(ctx.paymentProvider.calls).toHaveLength(1);
  expectSubscriptionStatus(ctx.repos, sub.id, 'past_due');
  expectSingleInvoice(ctx.repos, `inv_create_${sub.id}`, 'failed');

  await ctx.close();
});
