import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

/**
 * Persistence-level checks. These assert that the stored rows agree with the
 * API-visible outcome and the business rules at every stage — not just that a
 * request returned 2xx. Reads go through the repositories, the same seam the
 * service writes through.
 */
describe('persistence: subscriptions, invoices, webhook events, audit log', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.setup();
  });

  it('isolates state between tests (no stale data leaks in)', () => {
    verify(env).persisted.webhookEventCount(0);
    expect(env.db.subscriptions.count()).toBe(0);
    expect(env.db.invoices.count()).toBe(0);
  });

  it('writes a paid invoice and audit trail for an activated subscription', async () => {
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    const id = created.body.id;

    await env.api.postWebhook(
      env.webhook().withEventId('evt_1').forSubscription(id).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );

    verify(env).persisted
      .subscriptionStatus(id, 'active')
      .invoiceCount(id, 1)
      .paidInvoiceCount(id, 1)
      .invoiceStatus('inv_1', 'paid')
      .webhookEventRecorded('evt_1')
      .auditContainsType(id, 'subscription.created')
      .auditContainsType(id, 'payment.succeeded')
      .noContradictoryRecords(id);
  });

  it('records a failed invoice for a declined immediate charge and never marks it active', async () => {
    env.provider.willReturn('decline');

    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('basic').build(),
    );
    const id = created.body.id;

    verify(env).persisted
      .subscriptionStatus(id, 'past_due')
      .paidInvoiceCount(id, 0)
      .invoiceCount(id, 1);
    // Invariant: no `active` subscription exists without a paid invoice.
    expect(env.db.subscriptions.find((s) => s.status === 'active')).toHaveLength(0);
  });

  it('never writes duplicate invoice or event rows for a redelivered webhook', async () => {
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    const id = created.body.id;
    const event = env
      .webhook()
      .withEventId('evt_dup')
      .forSubscription(id)
      .forInvoice('inv_dup')
      .ofType('payment.succeeded')
      .build();

    await env.api.postWebhook(event);
    await env.api.postWebhook(event);
    await env.api.postWebhook(event);

    verify(env).persisted.invoiceCount(id, 1).webhookEventCount(1);
  });
});
