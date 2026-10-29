import { createHmac } from 'node:crypto';
import { createApp } from '../../../src/app';
import { BillingApiClient } from '../../framework/clients/BillingApiClient';
import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';
import type { WebhookDelivery } from '../../framework/webhooks/WebhookSimulator';

/**
 * Request authenticity, separate from business logic: a delivery that fails the HMAC check must be
 * rejected with 401 before the payload is even looked at, and must leave no trace anywhere.
 */
describe('POST /webhooks/payment-provider - signature verification', () => {
  let env: TestEnvironment;
  const event = () => aWebhookEvent().succeeded().build();

  beforeEach(async () => {
    env = TestEnvironment.create();
    await env.seedBilling('trialing', ['pending']);
  });

  it('accepts a body signed with the shared secret (HMAC-SHA256 over the raw body, hex)', async () => {
    const res = await env.webhooks.send(env.webhooks.signed(event()));

    BillingAssertions.expectWebhookAck(res, 'processed');
  });

  describe.each<[string, () => WebhookDelivery]>([
    ['no signature header', () => env.webhooks.unsigned(event())],
    ['signed with the wrong secret', () => env.webhooks.signedWithWrongSecret(event())],
    ['body altered after signing', () => env.webhooks.tamperedAfterSigning(event())],
    ['header is not a signature', () => env.webhooks.withSignatureHeader(event(), 'not-a-signature')],
    ['empty header', () => env.webhooks.withSignatureHeader(event(), '')],
    ['valid hex of the wrong length', () => env.webhooks.withSignatureHeader(event(), 'abcd')],
    ['right length but not hex', () => env.webhooks.withSignatureHeader(event(), 'z'.repeat(64))],
  ])('rejected: %s', (_name, delivery) => {
    it('returns 401 invalid_signature', async () => {
      const res = await env.webhooks.send(delivery());

      BillingAssertions.expectError(res, 401, 'invalid_signature');
    });

    it('persists nothing, not even a webhook event row', async () => {
      const before = await env.persistence.snapshot();

      await env.webhooks.send(delivery());

      await env.persistence.expectUnchangedSince(before);
      await env.persistence.expectNoWebhookEvents();
      await env.persistence.expectStoredStatus('sub_seed_001', 'trialing');
    });

    it('does not call the payment provider', async () => {
      await env.webhooks.send(delivery());

      env.providerCalls.expectNoCharges();
    });

    it('does not consume the event id: the genuine delivery is processed afterwards', async () => {
      await env.webhooks.send(delivery());

      const genuine = await env.webhooks.deliver(event());

      BillingAssertions.expectWebhookAck(genuine, 'processed');
      await env.persistence.expectWebhookEvent('evt_001', { outcome: 'processed', deliveryCount: 1 });
    });
  });

  it('checks the signature before the payload: a forged malformed body is 401, not 400', async () => {
    const forged: WebhookDelivery = { rawBody: '{"event_id": ', signature: 'f'.repeat(64) };

    const res = await env.webhooks.send(forged);

    BillingAssertions.expectError(res, 401, 'invalid_signature');
  });

  it('verifies the exact bytes received: the same JSON with different whitespace needs its own signature', async () => {
    const compact = env.webhooks.signed(event());
    const spaced: WebhookDelivery = { rawBody: JSON.stringify(event(), null, 2), signature: compact.signature };

    const res = await env.webhooks.send(spaced);

    BillingAssertions.expectError(res, 401, 'invalid_signature');
  });

  it('fails closed when the service has no webhook secret configured: 500, never "processed"', async () => {
    const unconfigured = new BillingApiClient(createApp({ webhookSecret: undefined }));
    const body = JSON.stringify(event());
    const signedWithEmptySecret = createHmac('sha256', '').update(body).digest('hex');

    const res = await unconfigured.postWebhook(body, signedWithEmptySecret);

    BillingAssertions.expectError(res, 500, 'internal_error');
  });

  it('accepts the same event once it is signed over its own bytes', async () => {
    const spaced = env.webhooks.signedRaw(JSON.stringify(event(), null, 2));

    const res = await env.webhooks.send(spaced);

    BillingAssertions.expectWebhookAck(res, 'processed');
  });
});
