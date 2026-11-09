import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

/**
 * These tests cover webhook *request handling* — signature verification and
 * payload shape — separately from webhook *business logic* (idempotency,
 * transitions), which lives in the webhooks/ and state-machine/ suites.
 */
describe('API contract: /webhooks/payment-provider', () => {
  let env: TestEnvironment;
  let subscriptionId: string;

  beforeEach(async () => {
    env = TestEnvironment.setup();
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    subscriptionId = created.body.id;
  });

  it('accepts a correctly-signed, well-formed webhook (200)', async () => {
    const event = env
      .webhook()
      .withEventId('evt_ok')
      .forSubscription(subscriptionId)
      .forInvoice('inv_ok')
      .ofType('payment.succeeded')
      .build();

    const res = await env.api.postWebhook(event);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    verify(env).persisted.webhookEventRecorded('evt_ok');
  });

  it('rejects an unsigned webhook (401) and applies no side effects', async () => {
    const event = env
      .webhook()
      .withEventId('evt_unsigned')
      .forSubscription(subscriptionId)
      .unsigned()
      .build();

    const res = await env.api.postWebhook(event);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_signature');
    verify(env).persisted.subscriptionStatus(subscriptionId, 'trialing').webhookEventCount(0);
  });

  it('rejects a tampered signature (401)', async () => {
    const event = env
      .webhook()
      .withEventId('evt_tampered')
      .forSubscription(subscriptionId)
      .withTamperedSignature()
      .build();

    const res = await env.api.postWebhook(event);

    expect(res.status).toBe(401);
    verify(env).persisted.webhookEventCount(0);
  });

  it('rejects a malformed (non-JSON) body (400)', async () => {
    const event = env.webhook().forSubscription(subscriptionId).malformedBody().build();

    const res = await env.api.postWebhook(event);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('malformed_payload');
    verify(env).persisted.webhookEventCount(0);
  });

  it('rejects a payload missing a required field (400)', async () => {
    const event = env
      .webhook()
      .forSubscription(subscriptionId)
      .without('event_id')
      .build();

    const res = await env.api.postWebhook(event);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('malformed_payload');
  });

  it('rejects an unknown event type (400)', async () => {
    const event = env
      .webhook()
      .withEventId('evt_bad_type')
      .forSubscription(subscriptionId)
      .build();
    // Corrupt the type after signing-time is irrelevant; rebuild with bad type.
    const tampered = {
      rawBody: JSON.stringify({
        ...JSON.parse(event.rawBody),
        type: 'payment.exploded',
      }),
      signature: undefined as string | undefined,
    };
    // Re-sign the corrupted body so we isolate the *type* failure, not signature.
    const { signPayload } = await import('../../src/payments/signature');
    tampered.signature = signPayload(tampered.rawBody, env.webhookSecret);

    const res = await env.api.postWebhook(tampered);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('malformed_payload');
  });

  it('returns 404 for a webhook referencing an unknown subscription', async () => {
    const event = env
      .webhook()
      .withEventId('evt_unknown_sub')
      .forSubscription('sub_ghost')
      .build();

    const res = await env.api.postWebhook(event);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('subscription_not_found');
    // An unknown-subscription event must not be recorded, so a later legitimate
    // delivery for a real subscription with that id is still processable.
    verify(env).persisted.webhookEventCount(0);
  });
});
