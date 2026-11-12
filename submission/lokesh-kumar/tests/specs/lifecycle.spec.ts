import { beforeEach, describe, expect, it } from 'vitest';
import { aCreateSubscriptionRequest } from '../support/builders/SubscriptionRequestBuilder.js';
import { aWebhookEvent } from '../support/builders/WebhookEventBuilder.js';
import { TestEnvironment } from '../support/TestEnvironment.js';

describe('Lifecycle', () => {
  let env: TestEnvironment;
  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('valid transitions driven by billing and the API', () => {
    it('trialing -> active: trial ends and the first charge succeeds', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();

      const res = await env.api.billSubscription(sub.id);

      expect(res.status).toBe(200);
      expect(res.body.subscription.status).toBe('active');
      expect(env.subscriptions.get(sub.id)?.status).toBe('active');
      expect(env.invoices.forSubscription(sub.id).map((i) => i.status)).toEqual(['paid']);
      await env.verify.assertConsistent(sub.id);
    });

    it('trialing -> past_due: trial ends and the first charge fails', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      env.provider.alwaysDecline();

      const res = await env.api.billSubscription(sub.id);

      expect(res.body.subscription.status).toBe('past_due');
      const invoices = env.invoices.forSubscription(sub.id);
      expect(invoices.map((i) => i.status)).toEqual(['failed']);
      expect(invoices[0].paidAt).toBeNull();
      await env.verify.assertConsistent(sub.id);
    });

    it('active -> past_due: a recurring charge fails', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('active').create();
      env.provider.alwaysDecline();

      const res = await env.api.billSubscription(sub.id);

      expect(res.body.subscription.status).toBe('past_due');
      expect(env.invoices.forSubscription(sub.id).map((i) => i.status)).toEqual(['paid', 'failed']);
      await env.verify.assertConsistent(sub.id);
    });

    it('past_due -> active: a retry charge succeeds', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('past_due').create();

      const res = await env.api.billSubscription(sub.id); // provider succeeds by default

      expect(res.body.subscription.status).toBe('active');
      expect(env.invoices.forSubscription(sub.id).map((i) => i.status)).toEqual(['failed', 'paid']);
      expect(env.subscriptions.get(sub.id)?.failedAttempts).toBe(0);
      await env.verify.assertConsistent(sub.id);
    });

    it('past_due -> canceled: retries are exhausted', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      env.provider.alwaysDecline();

      const statuses: string[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await env.api.billSubscription(sub.id);
        statuses.push(res.body.subscription.status);
      }

      expect(statuses).toEqual(['past_due', 'past_due', 'canceled']);
      expect(env.invoices.forSubscription(sub.id).map((i) => i.status)).toEqual(['failed', 'failed', 'failed']);
      expect(env.audit.forSubscription(sub.id).map((e) => e.to)).toEqual(['trialing', 'past_due', 'canceled']);
      await env.verify.assertConsistent(sub.id);
    });

    it('active -> canceled: customer cancels via the API', async () => {
      const sub = await env.aSubscription().onPlan('basic').inState('active').create();

      const res = await env.api.cancelSubscription(sub.id);

      expect(res.body.status).toBe('canceled');
      expect(env.audit.forSubscription(sub.id).pop()?.trigger).toBe('api_cancel');
      env.charges.expectNoCharges();
      await env.verify.assertConsistent(sub.id);
    });

    it('trialing -> canceled: customer cancels during the trial', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();

      const res = await env.api.cancelSubscription(sub.id);

      expect(res.body.status).toBe('canceled');
      expect(env.invoices.forSubscription(sub.id)).toHaveLength(0);
      await env.verify.assertConsistent(sub.id);
    });
  });

  describe('valid transitions driven by webhooks (provider timed out, webhook settles it)', () => {
    it('trialing -> active via payment.succeeded', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);
      expect(env.subscriptions.get(sub.id)?.status).toBe('trialing'); // timeout alone changes nothing

      const res = await env.webhooks.deliver(aWebhookEvent().succeeded().forInvoice(invoice).build());

      expect(res.body.status).toBe('applied');
      expect(env.subscriptions.get(sub.id)?.status).toBe('active');
      expect(env.invoices.latest(sub.id).status).toBe('paid');
      await env.verify.assertConsistent(sub.id);
    });

    it('trialing -> past_due via payment.failed', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);

      await env.webhooks.deliver(aWebhookEvent().failed().forInvoice(invoice).build());

      expect(env.subscriptions.get(sub.id)?.status).toBe('past_due');
      expect(env.invoices.latest(sub.id).status).toBe('failed');
      await env.verify.assertConsistent(sub.id);
    });

    it('active -> past_due via payment.failed on a renewal', async () => {
      const sub = await env.aSubscription().onPlan('basic').inState('active').create();
      const invoice = await env.leavePendingInvoice(sub.id);
      expect(env.subscriptions.get(sub.id)?.status).toBe('active');

      await env.webhooks.deliver(aWebhookEvent().failed().forInvoice(invoice).build());

      expect(env.subscriptions.get(sub.id)?.status).toBe('past_due');
      await env.verify.assertConsistent(sub.id);
    });

    it('past_due -> active via payment.succeeded on a retry', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('past_due').create();
      const invoice = await env.leavePendingInvoice(sub.id);

      await env.webhooks.deliver(aWebhookEvent().succeeded().forInvoice(invoice).build());

      expect(env.subscriptions.get(sub.id)?.status).toBe('active');
      await env.verify.assertConsistent(sub.id);
    });
  });

  describe('invalid transitions are impossible', () => {
    it('canceled never becomes active again, even when a payment.succeeded webhook arrives', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);
      await env.api.cancelSubscription(sub.id);
      const auditBefore = env.audit.forSubscription(sub.id).length;
      const event = aWebhookEvent().succeeded().forInvoice(invoice).build();

      const res = await env.webhooks.deliver(event);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ignored', outcome: 'ignored_canceled' });
      expect(env.subscriptions.get(sub.id)?.status).toBe('canceled');
      expect(env.invoices.latest(sub.id).status).toBe('pending'); // untouched
      expect(env.audit.forSubscription(sub.id)).toHaveLength(auditBefore);
      expect(env.events.get(event.event_id as string)?.outcome).toBe('ignored_canceled'); // recorded, not applied
      env.charges.expectNoCharges();
      await env.verify.assertConsistent(sub.id);
    });

    it('a canceled subscription cannot be billed again', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('canceled').create();
      const invoicesBefore = env.invoices.count();

      const res = await env.api.billSubscription(sub.id);

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('subscription_canceled');
      expect(env.invoices.count()).toBe(invoicesBefore);
      env.charges.expectNoCharges();
    });

    it('a past_due subscription cannot be canceled through the API (not in the lifecycle)', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('past_due').create();

      const res = await env.api.cancelSubscription(sub.id);

      expect(res.status).toBe(409);
      expect(env.subscriptions.get(sub.id)?.status).toBe('past_due');
      await env.verify.assertConsistent(sub.id);
    });
  });

  describe('plan-specific rules', () => {
    it('pro: starts in trialing for 14 days at 4900 and is not charged at creation', async () => {
      const res = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('pro').build());

      expect(res.body.status).toBe('trialing');
      expect(res.body.price).toBe(4900);
      expect(res.body.trial_ends_at).not.toBeNull();
      const trialMs = Date.parse(res.body.trial_ends_at as string) - Date.parse(res.body.created_at);
      expect(trialMs).toBe(14 * 24 * 60 * 60 * 1000);
      env.charges.expectNoCharges();
      expect(env.invoices.count()).toBe(0);
    });

    it('basic: no trial, charged 1900 immediately and active at once', async () => {
      const res = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('basic').build());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('active');
      expect(res.body.price).toBe(1900);
      expect(res.body.trial_ends_at).toBeNull();
      expect(env.provider.lastCall?.amount).toBe(1900);
      await env.verify.assertConsistent(res.body.id);
    });
  });
});
