import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';
import type { WebhookDelivery } from '../../framework/webhooks/WebhookSimulator';

/**
 * Correctly signed deliveries whose content is unusable: 400 malformed_payload, nothing persisted.
 * (A signed body is trusted to come from the provider, but it still has to make sense.)
 */
describe('POST /webhooks/payment-provider - payload validation', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = TestEnvironment.create();
    await env.seedBilling('trialing', ['pending']);
  });

  const expectRejectedAsMalformed = async (delivery: WebhookDelivery) => {
    const before = await env.persistence.snapshot();

    const res = await env.webhooks.send(delivery);

    BillingAssertions.expectError(res, 400, 'malformed_payload');
    await env.persistence.expectUnchangedSince(before);
    await env.persistence.expectNoWebhookEvents();
    env.providerCalls.expectNoCharges();
  };

  describe('body is not a JSON object', () => {
    it.each([
      ['truncated JSON', '{"event_id": '],
      ['not JSON at all', 'payment succeeded'],
      ['empty body', ''],
      ['a JSON array', '[]'],
      ['JSON null', 'null'],
      ['a JSON string', '"evt_001"'],
      ['a JSON number', '42'],
    ])('%s', async (_name, rawBody) => {
      await expectRejectedAsMalformed(env.webhooks.signedRaw(rawBody));
    });
  });

  describe('required fields', () => {
    it.each(['event_id', 'type', 'subscription_id', 'invoice_id', 'amount', 'currency'])(
      'missing %s',
      async (field) => {
        await expectRejectedAsMalformed(env.webhooks.signed(aWebhookEvent().without(field).build()));
      },
    );
  });

  describe('field values', () => {
    it.each<[string, string, unknown]>([
      ['event_id', 'empty', ''],
      ['event_id', 'blank', '   '],
      ['event_id', 'a number', 123],
      ['subscription_id', 'null', null],
      ['invoice_id', 'empty', ''],
      ['invoice_id', 'an object', {}],
      ['amount', 'a string', '4900'],
      ['amount', 'fractional', 49.5],
      ['amount', 'zero', 0],
      ['amount', 'negative', -4900],
      ['currency', 'empty', ''],
      ['currency', 'a number', 840],
      ['type', 'a number', 1],
      ['type', 'unsupported', 'payment.disputed'],
      ['type', 'wrong case', 'PAYMENT.SUCCEEDED'],
    ])('%s is %s', async (field, _description, value) => {
      await expectRejectedAsMalformed(env.webhooks.signed(aWebhookEvent().with(field, value).build()));
    });
  });

  it('ignores extra fields the service does not know about', async () => {
    const res = await env.webhooks.deliver({ ...aWebhookEvent().build(), livemode: false, extra: { a: 1 } });

    BillingAssertions.expectWebhookAck(res, 'processed');
  });

  describe('unknown subscription', () => {
    it('returns 404 subscription_not_found and persists nothing', async () => {
      const before = await env.persistence.snapshot();

      const res = await env.webhooks.deliver(aWebhookEvent().forSubscription('sub_nope').build());

      BillingAssertions.expectError(res, 404, 'subscription_not_found');
      await env.persistence.expectUnchangedSince(before);
      await env.persistence.expectNoWebhookEvents();
      env.providerCalls.expectNoCharges();
    });

    it('does not consume the event id: the same id is processed once the subscription is real', async () => {
      await env.webhooks.deliver(aWebhookEvent().forSubscription('sub_nope').build());

      const res = await env.webhooks.deliver(aWebhookEvent().build());

      BillingAssertions.expectWebhookAck(res, 'processed');
    });
  });
});
