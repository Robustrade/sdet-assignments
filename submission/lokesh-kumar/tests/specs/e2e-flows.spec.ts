import { beforeEach, describe, expect, it } from 'vitest';
import { aCreateSubscriptionRequest } from '../support/builders/SubscriptionRequestBuilder.js';
import { aWebhookEvent } from '../support/builders/WebhookEventBuilder.js';
import { TestEnvironment } from '../support/TestEnvironment.js';

// Each flow goes request/webhook -> service -> persistence -> provider, and re-verifies
// consistency (API == database == business rules) after EVERY step.
describe('End-to-end flows', () => {
  let env: TestEnvironment;
  beforeEach(() => {
    env = TestEnvironment.create();
  });

  it('pro customer: trial, first charge, renewal, cancel, then a stray webhook cannot revive it', async () => {
    const created = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('pro').build());
    const id = created.body.id;
    await env.verify.assertConsistent(id);

    await env.api.billSubscription(id); // trial ends -> active
    expect(env.subscriptions.get(id)?.status).toBe('active');
    await env.verify.assertConsistent(id);

    await env.api.billSubscription(id); // renewal
    expect(env.subscriptions.get(id)?.status).toBe('active');
    expect(env.invoices.forSubscription(id).map((i) => i.status)).toEqual(['paid', 'paid']);
    await env.verify.assertConsistent(id);

    await env.api.cancelSubscription(id);
    await env.verify.assertConsistent(id);

    const paidInvoice = env.invoices.forSubscription(id)[0];
    const stray = await env.webhooks.deliver(aWebhookEvent().succeeded().forInvoice(paidInvoice).build());
    expect(stray.body.outcome).toBe('ignored_canceled');
    expect(env.subscriptions.get(id)?.status).toBe('canceled');
    await env.verify.assertConsistent(id);

    env.charges.expectChargeCount(2); // first charge + renewal, nothing after cancel
  });

  it('declined first charge, then recovery on retry', async () => {
    env.provider.alwaysDecline();
    const created = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('basic').build());
    const id = created.body.id;
    expect(created.body.status).toBe('past_due');
    await env.verify.assertConsistent(id);

    env.provider.alwaysSucceed();
    await env.api.billSubscription(id);
    expect(env.subscriptions.get(id)?.status).toBe('active');
    expect(env.invoices.forSubscription(id).map((i) => i.status)).toEqual(['failed', 'paid']);
    await env.verify.assertConsistent(id);
  });

  it('full degradation: active -> past_due -> canceled, after which nothing can change it', async () => {
    const sub = await env.aSubscription().onPlan('basic').inState('active').create();
    env.provider.alwaysDecline();

    for (const expected of ['past_due', 'past_due', 'canceled']) {
      const res = await env.api.billSubscription(sub.id);
      expect(res.body.subscription.status).toBe(expected);
      await env.verify.assertConsistent(sub.id);
    }

    const retry = await env.api.billSubscription(sub.id);
    expect(retry.status).toBe(409);
    const cancel = await env.api.cancelSubscription(sub.id);
    expect(cancel.status).toBe(409);
    await env.verify.assertConsistent(sub.id);
    env.charges.expectChargeCount(3);
  });

  it('provider timeout resolved by webhook, then duplicate and late contradictory webhooks are harmless', async () => {
    const created = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('pro').build());
    const id = created.body.id;

    env.provider.alwaysTimeout();
    await env.api.billSubscription(id);
    expect(env.subscriptions.get(id)?.status).toBe('trialing');
    await env.verify.assertConsistent(id);

    const invoice = env.invoices.latest(id);
    const success = aWebhookEvent().succeeded().forInvoice(invoice).build();
    await env.webhooks.deliver(success);
    expect(env.subscriptions.get(id)?.status).toBe('active');
    await env.verify.assertConsistent(id);

    await env.webhooks.deliver(success); // redelivery
    await env.webhooks.deliver(aWebhookEvent().failed().forInvoice(invoice).build()); // late failure
    expect(env.subscriptions.get(id)?.status).toBe('active');
    expect(env.invoices.forSubscription(id)).toHaveLength(1);
    await env.verify.assertConsistent(id);

    env.charges.expectChargeCount(1); // only the timed-out attempt ever reached the provider
  });
});
