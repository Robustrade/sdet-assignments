import { describe, expect, it } from 'vitest';
import { aPaymentWebhook, type WebhookPayload } from '../support/builders/webhookEventBuilder';
import type { WebhookSimulator } from '../support/mocks/webhookSimulator';
import { useTestContext } from '../support/testContext';

const validBody = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    event_id: 'evt_shape_check',
    type: 'payment.succeeded',
    subscription_id: 'sub_1',
    invoice_id: 'inv_1',
    amount: 4900,
    currency: 'USD',
    ...overrides,
  });

describe('S. POST /webhooks/payment-provider: signature and payload checks', () => {
  const ctx = useTestContext();

  it.each([
    {
      problem: 'S1: signed with the wrong secret',
      send: (webhooks: WebhookSimulator, payload: WebhookPayload) => webhooks.deliverSignedWith(payload, 'whsec_attacker'),
    },
    {
      problem: 'S2: has no signature header',
      send: (webhooks: WebhookSimulator, payload: WebhookPayload) => webhooks.deliverWithoutSignature(payload),
    },
    {
      problem: 'S3: was changed after it was signed',
      send: (webhooks: WebhookSimulator, payload: WebhookPayload) =>
        webhooks.deliverTampered(payload, (original) => ({ ...original, type: 'payment.failed' })),
    },
    {
      problem: 'has a signature that is not hex',
      send: (webhooks: WebhookSimulator, payload: WebhookPayload) => webhooks.deliverWithSignature(payload, 'not-a-signature'),
    },
  ])('returns 401 and changes nothing when the request $problem', async ({ send }) => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    const before = dbCheck.snapshot(subscription.id);

    const response = await send(webhooks, aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build());

    expect(response.status).toBe(401);
    expect(response.errorCode()).toBe('INVALID_SIGNATURE');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
    expect(dbCheck.webhookEvents()).toEqual([]);
  });

  it.each([
    { problem: 'is not valid JSON', rawBody: '{"event_id": "evt_1", ', code: 'MALFORMED_PAYLOAD' },
    { problem: 'is a JSON array', rawBody: '[]', code: 'MALFORMED_PAYLOAD' },
    { problem: 'has no event_id', rawBody: validBody({ event_id: undefined }), code: 'VALIDATION_ERROR' },
    { problem: 'has an unknown event type', rawBody: validBody({ type: 'payment.disputed' }), code: 'UNKNOWN_EVENT_TYPE' },
    { problem: 'has an amount that is not whole cents', rawBody: validBody({ amount: '49.00' }), code: 'VALIDATION_ERROR' },
  ])('S4: returns 400 and changes nothing when a correctly signed body $problem', async ({ rawBody, code }) => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription } = await steps.proWithPendingInvoice();
    const before = dbCheck.snapshot(subscription.id);

    const response = await webhooks.deliverRaw(rawBody);

    expect(response.status).toBe(400);
    expect(response.errorCode()).toBe(code);
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
    expect(dbCheck.webhookEvents()).toEqual([]);
  });

  it.each([
    { problem: 'an invoice that does not exist', invoiceId: () => 'inv_does_not_exist' },
    { problem: "another subscription's invoice", invoiceId: (otherInvoiceId: string) => otherInvoiceId },
  ])('records but ignores a genuine event that points to $problem', async ({ invoiceId }) => {
    const { steps, webhooks, dbCheck, provider } = ctx();
    provider.respondWith('succeed');
    const other = await steps.create('basic');
    const otherInvoice = dbCheck.onlyInvoice(other.id);
    const { subscription } = await steps.proWithPendingInvoice();
    const before = dbCheck.snapshot(subscription.id);
    const event = aPaymentWebhook().paymentSucceeded().forSubscription(subscription.id).forInvoiceId(invoiceId(otherInvoice.id)).build();

    const response = await webhooks.deliver(event);

    expect(response.status).toBe(200);
    expect(response.data().outcome).toBe('ignored_unknown_reference');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
    expect(dbCheck.invoice(otherInvoice.id).status).toBe('paid');
    expect(dbCheck.webhookEvent(event.event_id)?.outcome).toBe('ignored_unknown_reference');
  });

  it('still processes the genuine event after rejected attempts', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    const event = aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build();

    await webhooks.deliverWithoutSignature(event);
    await webhooks.deliverSignedWith(event, 'whsec_attacker');
    const genuine = await webhooks.deliver(event);

    expect(genuine.status).toBe(200);
    expect(genuine.data()).toEqual({ event_id: event.event_id, outcome: 'processed' });
    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.webhookEvents()).toHaveLength(1);
  });
});
