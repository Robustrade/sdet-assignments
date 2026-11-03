import { describe, expect, it } from 'vitest';
import { expectError } from '../../support/api/HttpClient';
import type { ApiResponse } from '../../support/api/HttpClient';
import type { WebhookSimulator } from '../../support/webhooks/WebhookSimulator';
import { expectRowDeltas, expectSubscriptionState } from '../../support/assertions/expectations';
import { WebhookEventBuilder } from '../../support/builders/builders';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

/**
 * Request handling only: authentication, parsing, schema. Business effects of accepted webhooks
 * are covered in test/specs/webhooks. Every rejection must leave no trace in the database.
 */
describe('POST /webhooks/payment-provider — request handling', () => {
  const env = useTestEnvironment();

  async function pendingCharge() {
    const given = await env().given.awaitingFirstChargeOutcome();
    return { ...given, event: WebhookEventBuilder.paymentSucceeded(given.invoice) };
  }

  it('accepts a correctly signed event and acknowledges it with the event id', async () => {
    const { event, subscription } = await pendingCharge();
    const body = event.build();

    const ack = await env().webhooks.deliverOk(body);

    expect(ack).toEqual({ received: true, event_id: body.event_id, outcome: 'applied' });
    expect(env().db.webhookEvent(body.event_id)).toMatchObject({ type: 'payment.succeeded', outcome: 'applied', payload: JSON.stringify(body) });
    await expectSubscriptionState(env(), subscription.id, { status: 'active' });
  });

  describe('rejects unauthenticated deliveries with 401 and persists nothing', () => {
    type Send = (hooks: WebhookSimulator, event: Record<string, unknown>) => Promise<ApiResponse>;
    const cases: Array<[string, Send, string]> = [
      ['no signature header', (h, e) => h.deliverUnsigned(e), 'missing_signature'],
      ['empty signature header', (h, e) => h.deliverWithSignature(e, ''), 'missing_signature'],
      ['signature from the wrong secret', (h, e) => h.deliverSignedWithSecret(e, 'whsec_attacker'), 'invalid_signature'],
      ['signature that is not hex', (h, e) => h.deliverWithSignature(e, 'not-a-signature'), 'invalid_signature'],
      ['valid signature over a different body (tampered amount)', (h, e) => h.deliverTampered(e, { ...e, amount: 1 }), 'invalid_signature'],
    ];

    it.each(cases)('%s', async (_scenario, send, code) => {
      const { event, subscription } = await pendingCharge();
      const before = env().db.counts();

      const res = await send(env().webhooks, event.build());

      expectError(res, 401, code);
      expectRowDeltas(before, env().db.counts());
      await expectSubscriptionState(env(), subscription.id, { status: 'trialing' });
    });

    it('checks the signature before parsing: an unsigned malformed body is 401, not 400', async () => {
      expectError(await env().webhooks.deliverRaw('{not json', { signed: false }), 401, 'missing_signature');
    });
  });

  describe('rejects signed but unusable payloads with 400 and persists nothing', () => {
    it.each(['{not json', '', 'null', '"a string"'])('malformed body %j', async (raw) => {
      const before = env().db.counts();
      const res = await env().webhooks.deliverRaw(raw, { signed: true });
      expect(res.status).toBe(400);
      expectRowDeltas(before, env().db.counts());
    });

    it('400 malformed_payload for non-JSON', async () => {
      expectError(await env().webhooks.deliverRaw('{"event_id":', { signed: true }), 400, 'malformed_payload');
    });

    it.each([
      ['missing event_id', (e: WebhookEventBuilder) => e.without('event_id'), 'event_id'],
      ['empty event_id', (e: WebhookEventBuilder) => e.withEventId(''), 'event_id'],
      ['unknown type', (e: WebhookEventBuilder) => e.with('type', 'payment.teleported'), 'type'],
      ['missing invoice_id', (e: WebhookEventBuilder) => e.without('invoice_id'), 'invoice_id'],
      ['amount as string', (e: WebhookEventBuilder) => e.withAmount('4900'), 'amount'],
      ['negative amount', (e: WebhookEventBuilder) => e.withAmount(-4900), 'amount'],
      ['fractional amount', (e: WebhookEventBuilder) => e.withAmount(49.5), 'amount'],
      ['bad currency', (e: WebhookEventBuilder) => e.with('currency', 'DOLLARS'), 'currency'],
    ])('400 invalid_payload for %s', async (_case, mutate, field) => {
      const { event, subscription } = await pendingCharge();
      const before = env().db.counts();

      const error = expectError(await env().webhooks.deliver(mutate(event)), 400, 'invalid_payload');

      expect(error.error.details?.map((d) => d.field)).toContain(field);
      expectRowDeltas(before, env().db.counts());
      await expectSubscriptionState(env(), subscription.id, { status: 'trialing' });
    });
  });

  it('acknowledges (200) but ignores a valid event for an unknown invoice, and records it', async () => {
    const event = WebhookEventBuilder.paymentSucceeded({ id: 'inv_unknown', subscription_id: 'sub_unknown', amount: 4900, currency: 'USD' }).build();

    const ack = await env().webhooks.deliverOk(event);

    expect(ack).toMatchObject({ outcome: 'ignored', reason: 'unknown_invoice' });
    expect(env().db.webhookEvent(event.event_id)).toMatchObject({ outcome: 'ignored', reason: 'unknown_invoice' });
  });
});
