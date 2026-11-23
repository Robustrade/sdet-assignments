import { describe, expect, it } from 'vitest';
import { invoicesFor } from '../assertions/verify';
import { WebhookPayloadBuilder } from '../builders/builders';
import { advancePastProTrial, createSubscription, createTestContext } from '../fixtures/setup';

/**
 * End-to-end: API/webhook → service processing → persistence/provider interaction,
 * across the whole lifecycle in one journey.
 */
describe('end-to-end journey', () => {
  it('create → trial → active → past_due → active → canceled, then stray webhooks ignored', async () => {
    const ctx = createTestContext();
    ctx.mock.behaviorQueue = ['success', 'success'];

    // Create in trialing.
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    expect(sub['state']).toBe('trialing');

    // Trial ends, first charge succeeds → active.
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expect(ctx.store.subscriptions.get(id)!.state).toBe('active');

    // Recurring charge fails via webhook → past_due.
    const failed = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt_e2e_fail')
        .type('payment.failed')
        .subscriptionId(id)
        .invoiceId('inv_e2e_2')
        .amount(4900)
        .build(),
    );
    expect(failed.body['status']).toBe('applied');
    expect(ctx.store.subscriptions.get(id)!.state).toBe('past_due');

    // Retry succeeds → active again.
    const stored = ctx.store.subscriptions.get(id)!;
    await ctx.billing.retryPastDue(stored);
    expect(ctx.store.subscriptions.get(id)!.state).toBe('active');

    // Cancel via API → canceled.
    const canceled = await ctx.api.cancel(id);
    expect(canceled.status).toBe(200);
    expect(ctx.store.subscriptions.get(id)!.state).toBe('canceled');

    // A stray success webhook after cancel is ignored.
    const stray = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt_e2e_stray')
        .type('payment.succeeded')
        .subscriptionId(id)
        .invoiceId('inv_e2e_9')
        .amount(4900)
        .build(),
    );
    expect(stray.body['status']).toBe('ignored');
    expect(ctx.store.subscriptions.get(id)!.state).toBe('canceled');

    // Final accounting: 3 invoices, 2 provider calls, audit trail complete.
    const invoices = invoicesFor(ctx, id);
    expect(invoices).toHaveLength(3);
    expect(invoices.map((i) => i.status)).toEqual(['paid', 'failed', 'paid']);
    expect(ctx.mock.calls).toHaveLength(2);
    const kinds = ctx.store.auditLog.filter((e) => e.subscriptionId === id).map((e) => e.kind);
    expect(kinds).toEqual(['created', 'trial_charge_succeeded', 'recurring_charge_failed', 'retry_succeeded', 'cancel']);
  });
});
