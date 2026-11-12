import { beforeEach, describe, expect, it } from 'vitest';
import { aWebhookEvent } from '../support/builders/WebhookEventBuilder.js';
import { TestEnvironment } from '../support/TestEnvironment.js';

describe('Webhook idempotency, ordering and validation', () => {
  let env: TestEnvironment;
  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('duplicate delivery of the same event_id', () => {
    it('payment.succeeded delivered twice transitions exactly once', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);
      const event = aWebhookEvent().succeeded().forInvoice(invoice).build();

      const first = await env.webhooks.deliver(event);
      const second = await env.webhooks.deliver(event);

      expect(first.body.status).toBe('applied');
      expect(second.status).toBe(200); // acknowledged so the provider stops retrying
      expect(second.body.status).toBe('duplicate');

      expect(env.subscriptions.get(sub.id)?.status).toBe('active');
      expect(env.invoices.forSubscription(sub.id)).toHaveLength(1); // no duplicate invoice
      expect(env.audit.forSubscription(sub.id).filter((e) => e.to === 'active')).toHaveLength(1);
      const record = env.events.get(event.event_id as string);
      expect(record?.deliveryCount).toBe(2); // the duplicate was recorded, as a no-op
      expect(record?.outcome).toBe('applied');
      env.charges.expectNoCharges(); // a replay never charges anyone
      await env.verify.assertConsistent(sub.id);
    });

    it('payment.failed delivered twice counts as ONE failed attempt', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);
      const event = aWebhookEvent().failed().forInvoice(invoice).build();

      await env.webhooks.deliver(event);
      await env.webhooks.deliver(event);
      await env.webhooks.deliver(event);

      expect(env.subscriptions.get(sub.id)?.status).toBe('past_due');
      // If duplicates were counted, 3 deliveries would exhaust retries and cancel the subscription.
      expect(env.subscriptions.get(sub.id)?.failedAttempts).toBe(1);
      expect(env.invoices.forSubscription(sub.id)).toHaveLength(1);
      expect(env.events.get(event.event_id as string)?.deliveryCount).toBe(3);
      await env.verify.assertConsistent(sub.id);
    });
  });

  describe('out-of-order and contradictory delivery', () => {
    it('payment.failed arriving AFTER payment.succeeded for the same invoice does not regress the subscription', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);
      const succeeded = aWebhookEvent().succeeded().forInvoice(invoice).build();
      const lateFailure = aWebhookEvent().failed().forInvoice(invoice).build();

      await env.webhooks.deliver(succeeded);
      const res = await env.webhooks.deliver(lateFailure);

      expect(res.body).toEqual({ status: 'ignored', outcome: 'ignored_stale' });
      expect(env.subscriptions.get(sub.id)?.status).toBe('active');
      expect(env.subscriptions.get(sub.id)?.failedAttempts).toBe(0);
      const stored = env.invoices.latest(sub.id);
      expect(stored.status).toBe('paid');
      expect(stored.failureReason).toBeNull();
      expect(env.events.get(lateFailure.event_id as string)?.outcome).toBe('ignored_stale');
      await env.verify.assertConsistent(sub.id);
    });

    it('a second, different success event for an already paid invoice is ignored as stale', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);

      await env.webhooks.deliver(aWebhookEvent().succeeded().forInvoice(invoice).build());
      const res = await env.webhooks.deliver(aWebhookEvent().succeeded().forInvoice(invoice).build());

      expect(res.body.outcome).toBe('ignored_stale');
      expect(env.audit.forSubscription(sub.id).filter((e) => e.to === 'active')).toHaveLength(1);
      await env.verify.assertConsistent(sub.id);
    });
  });

  describe('events that must be rejected without persisting anything', () => {
    it('unknown subscription returns 404 and is not recorded', async () => {
      const res = await env.webhooks.deliver(aWebhookEvent().forSubscription('sub_ghost').build());
      expect(res.status).toBe(404);
      expect(env.events.count()).toBe(0);
    });

    it('an invoice belonging to a different subscription returns 404 and changes nothing', async () => {
      const first = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const second = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoiceOfFirst = await env.leavePendingInvoice(first.id);

      const res = await env.webhooks.deliver(
        aWebhookEvent().succeeded().forInvoice(invoiceOfFirst).forSubscription(second.id).build(),
      );

      expect(res.status).toBe(404);
      expect(env.events.count()).toBe(0);
      expect(env.subscriptions.get(second.id)?.status).toBe('trialing');
      expect(env.invoices.latest(first.id).status).toBe('pending');
    });

    it('an amount that does not match the invoice returns 422 and changes nothing', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);

      const res = await env.webhooks.deliver(aWebhookEvent().succeeded().forInvoice(invoice).withAmount(100).build());

      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe('amount_mismatch');
      expect(env.events.count()).toBe(0);
      expect(env.subscriptions.get(sub.id)?.status).toBe('trialing');
      expect(env.invoices.latest(sub.id).status).toBe('pending');
    });
  });

  describe('payment.refunded', () => {
    it('marks a paid invoice refunded without changing the subscription status', async () => {
      const sub = await env.aSubscription().onPlan('basic').inState('active').create();
      const invoice = env.invoices.latest(sub.id);
      const auditBefore = env.audit.forSubscription(sub.id).length;

      const res = await env.webhooks.deliver(aWebhookEvent().refunded().forInvoice(invoice).build());

      expect(res.body.status).toBe('applied');
      expect(env.invoices.latest(sub.id).status).toBe('refunded');
      expect(env.subscriptions.get(sub.id)?.status).toBe('active');
      expect(env.audit.forSubscription(sub.id)).toHaveLength(auditBefore);
      await env.verify.assertConsistent(sub.id);
    });

    it('a refund for an invoice that was never paid is ignored', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);

      const res = await env.webhooks.deliver(aWebhookEvent().refunded().forInvoice(invoice).build());

      expect(res.body.outcome).toBe('ignored_invalid_transition');
      expect(env.invoices.latest(sub.id).status).toBe('pending');
    });
  });
});
