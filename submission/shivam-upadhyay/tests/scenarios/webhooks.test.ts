import { describe, expect, it } from 'vitest';
import { expectInvoiceCount, expectProviderCalls, expectState } from '../assertions/verify';
import { WebhookPayloadBuilder } from '../builders/builders';
import { advancePastProTrial, createSubscription, createTestContext } from '../fixtures/setup';
import type { WebhookPayload } from '../mocks/webhookSimulator';

/** D — webhook idempotency / duplicate delivery (mandatory) + handling. */
describe('D — webhook idempotency & handling', () => {
  it('duplicate payment.succeeded transitions exactly once', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const payload = new WebhookPayloadBuilder()
      .eventId('evt_dup_1')
      .type('payment.succeeded')
      .subscriptionId(id)
      .invoiceId('inv_001')
      .amount(4900)
      .build();
    const first = await ctx.webhooks.send(payload);
    expect(first.status).toBe(200);
    expect(first.body['status']).toBe('applied');
    expectState(ctx, id, 'active');
    expectInvoiceCount(ctx, id, 1);
    const second = await ctx.webhooks.send(payload);
    expect(second.status).toBe(200);
    expect(second.body['status']).toBe('duplicate');
    expectState(ctx, id, 'active');
    expectInvoiceCount(ctx, id, 1);
    expectProviderCalls(ctx, 0);
  });

  it('duplicate payment.failed is a no-op (no duplicate invoice, no extra retry)', async () => {
    const ctx = createTestContext();
    ctx.mock.defaultBehavior = 'decline';
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'past_due');
    expectInvoiceCount(ctx, id, 1);
    const payload = new WebhookPayloadBuilder()
      .eventId('evt_dup_2')
      .type('payment.failed')
      .subscriptionId(id)
      .invoiceId('inv_002')
      .amount(4900)
      .build();
    const first = await ctx.webhooks.send(payload);
    expect(first.body['status']).toBe('applied');
    expectInvoiceCount(ctx, id, 2);
    expect(ctx.store.subscriptions.get(id)!.retryCount).toBe(1);
    const second = await ctx.webhooks.send(payload);
    expect(second.body['status']).toBe('duplicate');
    expectInvoiceCount(ctx, id, 2);
    expect(ctx.store.subscriptions.get(id)!.retryCount).toBe(1);
  });

  it('invalid signature is rejected before any state change', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const res = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt_bad_sig')
        .type('payment.succeeded')
        .subscriptionId(id)
        .invoiceId('inv_001')
        .amount(4900)
        .build(),
      { signature: 'invalid' },
    );
    expect(res.status).toBe(401);
    expect(res.body['error']).toBe('invalid_signature');
    expectState(ctx, id, 'trialing');
    expectInvoiceCount(ctx, id, 0);
    expect(ctx.store.webhookEvents.has('evt_bad_sig')).toBe(false);
  });

  it('missing signature is rejected', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const res = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt_no_sig')
        .type('payment.succeeded')
        .subscriptionId(id)
        .invoiceId('inv_001')
        .amount(4900)
        .build(),
      { signature: 'absent' },
    );
    expect(res.status).toBe(401);
    expectState(ctx, id, 'trialing');
  });

  it('malformed payload is rejected with 400', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const res = await ctx.webhooks.send(
      new WebhookPayloadBuilder().eventId('evt_malformed').subscriptionId(id).build(),
      { rawBody: '{not json' },
    );
    expect(res.status).toBe(400);
    expect(res.body['error']).toBe('malformed_payload');
    expectState(ctx, id, 'trialing');
  });

  it('unknown event type is rejected', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const payload = {
      ...new WebhookPayloadBuilder().eventId('evt_unknown').subscriptionId(id).build(),
      type: 'payment.whatever',
    } as unknown as WebhookPayload;
    const res = await ctx.webhooks.send(payload);
    expect(res.status).toBe(400);
    expect(res.body['error']).toBe('unknown_event_type');
    expectState(ctx, id, 'trialing');
  });

  it('payment.failed after payment.succeeded for the same invoice does not regress', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const ok = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt_ok_1')
        .type('payment.succeeded')
        .subscriptionId(id)
        .invoiceId('inv_001')
        .amount(4900)
        .build(),
    );
    expect(ok.body['status']).toBe('applied');
    expectState(ctx, id, 'active');
    const late = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt_late_fail')
        .type('payment.failed')
        .subscriptionId(id)
        .invoiceId('inv_001')
        .amount(4900)
        .build(),
    );
    expect(late.body['status']).toBe('ignored');
    expectState(ctx, id, 'active');
    expectInvoiceCount(ctx, id, 1);
  });

  it('payment.refunded records the refund without regressing state', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'active');
    const res = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt_refund_1')
        .type('payment.refunded')
        .subscriptionId(id)
        .invoiceId(`trial-${id}`)
        .amount(4900)
        .build(),
    );
    expect(res.status).toBe(200);
    expect(res.body['status']).toBe('applied');
    expectState(ctx, id, 'active');
    const invoices = [...ctx.store.invoices.values()].filter((i) => i.subscriptionId === id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.status).toBe('refunded');
  });
});
