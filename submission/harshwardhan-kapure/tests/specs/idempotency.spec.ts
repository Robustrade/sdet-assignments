import { beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../support/TestContext';
import { aWebhook } from '../support/builders';
import { expectApiMatchesDb, expectNoDuplicateInvoices } from '../support/assertions';

describe('Webhook Idempotency & Replay Protection', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = TestContext.create();
  });

  it('delivers same payment.succeeded event_id twice with one transition, one invoice, and zero extra provider calls', async () => {
    const customer = ctx.seedCustomer();
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

    const webhook = aWebhook()
      .withEventId('evt_dup_success_01')
      .paymentSucceeded()
      .forSubscription(sub.id)
      .forInvoice('inv_dup_01')
      .withAmount(4900)
      .signed();

    const first = await ctx.api.sendWebhook(webhook);
    const second = await ctx.api.sendWebhook(webhook);

    expect(first.status).toBe(200);
    expect(first.body.status).toBe('processed');

    expect(second.status).toBe(200);
    expect(second.body.status).toBe('duplicate');

    expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('active');
    expectNoDuplicateInvoices(ctx.repo, sub.id, 1);

    const events = ctx.repo.findWebhookEventsByEventId('evt_dup_success_01');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.processing_status)).toEqual(['processed', 'duplicate']);

    const auditLogs = ctx.repo.findAuditLogsBySubscriptionId(sub.id);
    expect(auditLogs).toHaveLength(2); // creation (null -> trialing) + 1 transition (trialing -> active)
    expect(ctx.provider.getCallCount()).toBe(0);

    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
  });

  it('delivers same payment.failed event_id twice without incrementing retry_count twice or exhausting retries early', async () => {
    const customer = ctx.seedCustomer();
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

    const webhook = aWebhook()
      .withEventId('evt_dup_fail_01')
      .paymentFailed()
      .forSubscription(sub.id)
      .forInvoice('inv_dup_fail_01')
      .withAmount(4900)
      .signed();

    const first = await ctx.api.sendWebhook(webhook);
    const second = await ctx.api.sendWebhook(webhook);

    expect(first.body.status).toBe('processed');
    expect(second.body.status).toBe('duplicate');

    const dbSub = ctx.repo.findSubscriptionById(sub.id)!;
    expect(dbSub.status).toBe('past_due');
    expect(dbSub.retry_count).toBe(1);
    expectNoDuplicateInvoices(ctx.repo, sub.id, 1);
    expect(ctx.provider.getCallCount()).toBe(0);
  });

  it('records payment.refunded webhook idempotently for a paid invoice without duplicate side effects', async () => {
    const customer = ctx.seedCustomer();
    const sub = await ctx.createSubscriptionViaApi(customer, 'basic');
    const [paidInvoice] = ctx.repo.findInvoicesBySubscriptionId(sub.id);

    const refundWebhook = aWebhook()
      .withEventId('evt_refund_01')
      .paymentRefunded()
      .forSubscription(sub.id)
      .forInvoice(paidInvoice.id)
      .withAmount(1900)
      .signed();

    const first = await ctx.api.sendWebhook(refundWebhook);
    const second = await ctx.api.sendWebhook(refundWebhook);

    expect(first.body.status).toBe('processed');
    expect(second.body.status).toBe('duplicate');
    expect(ctx.repo.findInvoiceById(paidInvoice.id)!.status).toBe('refunded');
    expect(ctx.repo.findWebhookEventsByEventId('evt_refund_01')).toHaveLength(2);
  });

  it('ignores payment.refunded webhook when target invoice does not exist or was never paid', async () => {
    const customer = ctx.seedCustomer();
    const sub = await ctx.givenPastDueSubscription(customer, 1);
    const [failedInvoice] = ctx.repo.findInvoicesBySubscriptionId(sub.id);

    const refundFailedRes = await ctx.api.sendWebhook(
      aWebhook()
        .paymentRefunded()
        .forSubscription(sub.id)
        .forInvoice(failedInvoice.id)
        .withAmount(4900)
        .signed()
    );
    const refundMissingRes = await ctx.api.sendWebhook(
      aWebhook()
        .paymentRefunded()
        .forSubscription(sub.id)
        .forInvoice('inv_never_existed')
        .withAmount(4900)
        .signed()
    );

    expect(refundFailedRes.body.status).toBe('ignored');
    expect(refundMissingRes.body.status).toBe('ignored');
    expect(ctx.repo.findInvoiceById(failedInvoice.id)!.status).toBe('failed');
    expect(ctx.repo.findInvoiceById('inv_never_existed')).toBeUndefined();
  });
});
