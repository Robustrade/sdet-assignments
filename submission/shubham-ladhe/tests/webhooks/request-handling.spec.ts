import { WebhookSignature } from '../../src/services/WebhookSignature';
import { SignatureMode } from '../framework/api/WebhookSender';
import { aWebhook, WebhookEventBuilder } from '../framework/builders';
import { WEBHOOK_SECRET } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';
import { expectError } from '../framework/verify/expectations';

/**
 * Request-level handling of the webhook endpoint: authentication and payload shape.
 * Kept apart from the business effects of events (tests/lifecycle, tests/reliability).
 * Every rejection here must leave the database exactly as it was.
 */
describe('POST /webhooks/payment-provider: request handling', () => {
  const env = useHarness();

  /** A genuine, applicable event: success for a signup charge whose outcome we don't know yet. */
  async function aGenuineSuccessEvent() {
    const { invoiceId } = await env().given.signupChargeOutcomeUnknown();
    return env().webhooks.about(invoiceId).paymentSucceeded().build();
  }

  describe('signature', () => {
    const rejected: Array<{ name: string; mode: SignatureMode; code: string }> = [
      { name: 'header missing', mode: 'missing', code: 'missing_signature' },
      { name: 'signed with the wrong secret', mode: 'wrong-secret', code: 'invalid_signature' },
      { name: 'body changed after signing', mode: 'tampered', code: 'invalid_signature' },
      { name: 'header is not hex', mode: { header: 'not-a-signature' }, code: 'invalid_signature' },
    ];

    it.each(rejected)('$name -> 401 $code, nothing recorded or applied', async ({ mode, code }) => {
      const event = await aGenuineSuccessEvent();
      const dbBefore = env().snapshot();

      const response = await env().webhooks.send(event, mode);

      expectError(response, 401, code);
      expect(env().tablesChangedSince(dbBefore)).toEqual([]);
      expect(env().repos.webhookEvents.findById(event.event_id)).toBeUndefined();
    });

    it('a valid signature over the exact bytes is accepted', async () => {
      const event = await aGenuineSuccessEvent();

      const response = await env().webhooks.send(event, 'valid');

      expect(response).toMatchObject({ status: 200, body: { event_id: event.event_id, outcome: 'processed' } });
    });

    it('signature covers raw bytes, not parsed JSON: re-serialising with different spacing breaks it', async () => {
      const event = await aGenuineSuccessEvent();
      const signatureOfCompactJson = new WebhookSignature(WEBHOOK_SECRET).sign(JSON.stringify(event));

      const response = await env().webhooks.sendRaw(JSON.stringify(event, null, 2), { header: signatureOfCompactJson });

      expectError(response, 401, 'invalid_signature');
    });
  });

  describe('payload (validly signed, so these reach parsing)', () => {
    const malformed: Array<{ name: string; rawBody: () => string }> = [
      { name: 'not JSON', rawBody: () => '{"event_id": "evt_1", ' },
      { name: 'missing event_id', rawBody: () => JSON.stringify(aWebhook().without('event_id').build()) },
      { name: 'unsupported event type', rawBody: () => JSON.stringify(aWebhook().with('type', 'customer.deleted').build()) },
      { name: 'amount is a string', rawBody: () => JSON.stringify(aWebhook().with('amount', '4900').build()) },
      { name: 'amount is negative', rawBody: () => JSON.stringify(aWebhook().withAmount(-1).build()) },
    ];

    it.each(malformed)('$name -> 400 malformed_payload, nothing recorded', async ({ rawBody }) => {
      await env().given.signupChargeOutcomeUnknown();
      const dbBefore = env().snapshot();

      const response = await env().webhooks.sendRaw(rawBody(), 'valid');

      expectError(response, 400, 'malformed_payload');
      expect(env().tablesChangedSince(dbBefore)).toEqual([]);
    });
  });

  describe('well-formed events that do not match our records are acknowledged but not applied', () => {
    // 200 so the provider stops redelivering; recorded as ignored with a reason for follow-up.
    const mismatches: Array<{ name: string; mismatch: (event: WebhookEventBuilder) => WebhookEventBuilder; reason: string }> = [
      { name: 'unknown invoice', mismatch: (event) => event.with('invoice_id', 'inv_9999'), reason: 'unknown_invoice' },
      { name: 'amount differs from invoice', mismatch: (event) => event.withAmount(1), reason: 'amount_mismatch' },
    ];

    it.each(mismatches)('$name -> 200 ignored ($reason)', async ({ mismatch, reason }) => {
      const { subscriptionId, invoiceId } = await env().given.signupChargeOutcomeUnknown();
      const event = mismatch(env().webhooks.about(invoiceId).paymentSucceeded()).build();

      const response = await env().webhooks.send(event);

      expect(response).toMatchObject({ status: 200, body: { outcome: 'ignored', reason } });
      expect(env().repos.webhookEvents.findById(event.event_id)).toMatchObject({ outcome: 'ignored', reason });
      expect(env().stored(subscriptionId).status).toBe('trialing');
    });

    it('invoice belongs to a different subscription -> ignored, neither subscription changes', async () => {
      const first = await env().given.signupChargeOutcomeUnknown();
      const second = await env().given.signupChargeOutcomeUnknown();
      const event = env().webhooks.about(first.invoiceId).paymentSucceeded().with('subscription_id', second.subscriptionId).build();

      const response = await env().webhooks.send(event);

      expect(response.body).toMatchObject({ outcome: 'ignored', reason: 'invoice_subscription_mismatch' });
      expect(env().stored(first.subscriptionId).status).toBe('trialing');
      expect(env().stored(second.subscriptionId).status).toBe('trialing');
    });
  });
});
