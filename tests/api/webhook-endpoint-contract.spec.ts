import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnvironment } from '../framework/TestEnvironment.js';
import type { TestEnvironment } from '../framework/contracts.js';
import { WebhookPayloadBuilder } from '../builders/WebhookPayloadBuilder.js';
import { SubscriptionRequestBuilder } from '../builders/SubscriptionRequestBuilder.js';
import { SubscriptionAssertions } from '../framework/assertions/SubscriptionAssertions.js';
import { signWebhook } from '../../src/webhookSignature.js';

describe('POST /webhooks/payment-provider — request contract', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it('processes a webhook with a valid signature', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_valid_1')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_valid_1')
      .withAmount(1900)
      .build();

    const res = await env.webhookSimulator.deliver(payload, 'valid');
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('processed');

    const sub = env.subscriptions.findById(id);
    SubscriptionAssertions.expectState(sub, 'active');
  });

  it('rejects a webhook with a missing signature before any processing', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_no_sig')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_no_sig')
      .build();

    const res = await env.webhookSimulator.deliver(payload, 'missing');
    expect(res.status).toBe(401);
    expect(env.webhookEvents.count()).toBe(0);
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'trialing');
  });

  it('rejects a webhook signed with the wrong secret', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_wrong_sig')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_wrong_sig')
      .build();

    const res = await env.webhookSimulator.deliver(payload, 'wrong-secret');
    expect(res.status).toBe(401);
    expect(env.webhookEvents.count()).toBe(0);
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'trialing');
  });

  it('rejects a webhook whose body was tampered after signing', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_tamper')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_tamper')
      .build();
    const rawBody = JSON.stringify(payload);
    const signature = signWebhook(rawBody, env.signingSecret);

    const tampered = JSON.stringify({ ...payload, amount: 999999 });
    const res = await env.apiClient.postWebhook(tampered, signature);
    expect(res.status).toBe(401);
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'trialing');
  });

  it('returns 400 for malformed (non-JSON) payload', async () => {
    const res = await env.apiClient.postWebhook('this is not json', signWebhook('this is not json', env.signingSecret));
    expect(res.status).toBe(400);
    expect(env.webhookEvents.count()).toBe(0);
  });

  it('records an unsupported event type as a no-op without changing state', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_refund_1')
      .ofType('payment.refunded')
      .forSubscription(id)
      .forInvoice('inv_refund_1')
      .build();

    const res = await env.webhookSimulator.deliver(payload, 'valid');
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('noop_refunded');
    expect(env.webhookEvents.hasProcessed('evt_refund_1')).toBe(true);
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'trialing');
  });
});