import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnvironment } from '../framework/TestEnvironment.js';
import type { TestEnvironment } from '../framework/contracts.js';
import { SubscriptionRequestBuilder } from '../builders/SubscriptionRequestBuilder.js';
import { WebhookPayloadBuilder } from '../builders/WebhookPayloadBuilder.js';
import { InvoiceAssertions } from '../framework/assertions/InvoiceAssertions.js';

describe('Invoice and webhook-event persistence', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it('writes a failed invoice for a declined immediate charge', async () => {
    env.provider.willDecline();
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );
    const id = created.body.id as string;

    const invoices = env.invoices.forSubscription(id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.status).toBe('failed');
    expect(invoices[0]!.amount).toBe(4900);
  });

  it('does not persist a succeeded invoice when the charge declined', async () => {
    env.provider.willDecline();
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );
    const id = created.body.id as string;

    const invoices = env.invoices.forSubscription(id);
    expect(invoices.every((i) => i.status === 'failed')).toBe(true);
  });

  it('records a webhook event row for a processed event', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_audit_1')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_audit_1')
        .build(),
    );

    expect(env.webhookEvents.hasProcessed('evt_audit_1')).toBe(true);
    const record = env.webhookEvents.findByEventId('evt_audit_1');
    expect(record!.outcome).toBe('processed');
  });

  it('records only one webhook row for a duplicate event and no duplicate invoice', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_dup_persist')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_dup_persist')
      .build();

    await env.webhookSimulator.deliver(payload);
    await env.webhookSimulator.deliver(payload);

    expect(env.webhookEvents.count()).toBe(1);
    InvoiceAssertions.expectExactlyOneInvoiceFor(id, env.invoices.forSubscription(id));
    InvoiceAssertions.expectNoDuplicateInvoiceFor(id, 'inv_dup_persist', env.invoices.forSubscription(id));
  });

  it("records a no-op'd event (invalid transition via webhook) but does not regress state", async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    await env.apiClient.cancelSubscription(id);

    const res = await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_after_cancel')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_after_cancel')
        .build(),
    );

    expect(res.body.outcome).toBe('noop_illegal');
    expect(env.webhookEvents.hasProcessed('evt_after_cancel')).toBe(true);
    expect(env.subscriptions.findById(id)!.state).toBe('canceled');
    expect(env.invoices.forSubscription(id)).toHaveLength(0);
  });

  it('persists invoice rows in order without contradictory succeeded-after-failed for same invoice', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_ok_1')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_same')
        .build(),
    );

    await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_stale_1')
        .ofType('payment.failed')
        .forSubscription(id)
        .forInvoice('inv_same')
        .build(),
    );

    const invoices = env.invoices.forSubscription(id);
    const succeeded = invoices.filter((i) => i.invoiceId === 'inv_same' && i.status === 'succeeded');
    const failed = invoices.filter((i) => i.invoiceId === 'inv_same' && i.status === 'failed');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(0);
  });
});