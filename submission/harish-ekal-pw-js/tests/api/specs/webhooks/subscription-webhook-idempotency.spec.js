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
  expectWebhookProcessedOnce,
} = require('../../pom/assertions/persistenceAsserts');

test('duplicate webhook event_id is idempotent', async () => {
  const ctx = await boot();

  const subRes = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('basic').build(),
  );
  const sub = await subRes.json();

  const payload = new WebhookEventBuilder()
    .withEventId('evt_dup_1')
    .withType('payment.succeeded')
    .withSubscriptionId(sub.id)
    .withInvoiceId('inv_dup_1')
    .withAmount(1900)
    .build();

  const first = await ctx.api.sendWebhook(payload, ctx.webhookSecret);
  const second = await ctx.api.sendWebhook(payload, ctx.webhookSecret);

  expect(first.status()).toBe(200);
  expect(second.status()).toBe(200);

  expectSubscriptionStatus(ctx.repos, sub.id, 'active');
  expectSingleInvoice(ctx.repos, 'inv_dup_1', 'succeeded');
  expectWebhookProcessedOnce(ctx.repos, 'evt_dup_1');

  await ctx.close();
});

test('out-of-order failed event after success for same invoice does not regress', async () => {
  const ctx = await boot();

  const subRes = await ctx.api.createSubscription(
    new SubscriptionRequestBuilder().withPlan('basic').build(),
  );
  const sub = await subRes.json();

  const successFirst = new WebhookEventBuilder()
    .withEventId('evt_order_succ')
    .withType('payment.succeeded')
    .withSubscriptionId(sub.id)
    .withInvoiceId('inv_order_1')
    .withAmount(1900)
    .build();
  await ctx.api.sendWebhook(successFirst, ctx.webhookSecret);

  const staleFailed = new WebhookEventBuilder()
    .withEventId('evt_order_fail')
    .withType('payment.failed')
    .withSubscriptionId(sub.id)
    .withInvoiceId('inv_order_1')
    .withAmount(1900)
    .build();
  await ctx.api.sendWebhook(staleFailed, ctx.webhookSecret);

  expectSubscriptionStatus(ctx.repos, sub.id, 'active');
  expect(ctx.repos.invoiceRepo.findByInvoiceId('inv_order_1')).toHaveLength(1);
  expect(ctx.repos.invoiceRepo.findByInvoiceId('inv_order_1')[0].status).toBe(
    'succeeded',
  );

  await ctx.close();
});
