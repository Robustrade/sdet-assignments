import { beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../support/TestContext';
import { aSubscription, aWebhook } from '../support/builders';
import { expectApiMatchesDb, expectAuditTrail } from '../support/assertions';

describe('API Contract & Validation', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = TestContext.create();
  });

  describe('POST /subscriptions', () => {
    it('creates a pro subscription in trialing without immediate charge', async () => {
      const customer = ctx.seedCustomer();
      const res = await ctx.api.createSubscription(
        aSubscription().forCustomer(customer.id).pro().buildRequest()
      );

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^sub_/);
      expect(res.body.customer_id).toBe(customer.id);
      expect(res.body.plan).toBe('pro');
      expect(res.body.status).toBe('trialing');
      expect(res.body.trial_ends_at).toBeTruthy();
      expect(ctx.provider.getCallCount()).toBe(0);
      await expectApiMatchesDb(ctx.api, ctx.repo, res.body.id);
    });

    it('creates a basic subscription and charges immediately to active', async () => {
      const customer = ctx.seedCustomer();
      ctx.provider.respondWithSuccess();

      const res = await ctx.api.createSubscription(
        aSubscription().forCustomer(customer.id).basic().buildRequest()
      );

      expect(res.status).toBe(201);
      expect(res.body.plan).toBe('basic');
      expect(res.body.status).toBe('active');
      expect(res.body.trial_ends_at).toBeNull();
      expect(ctx.provider.getCallCount()).toBe(1);
      await expectApiMatchesDb(ctx.api, ctx.repo, res.body.id);
    });

    it('handles client retries safely with Idempotency-Key without double-charging', async () => {
      const customer = ctx.seedCustomer();
      ctx.provider.respondWithSuccess();
      const payload = aSubscription().forCustomer(customer.id).basic().buildRequest();

      const first = await ctx.api.createSubscription(payload, { idempotencyKey: 'idem_create_01' });
      const retry = await ctx.api.createSubscription(payload, { idempotencyKey: 'idem_create_01' });

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body.id).toBe(first.body.id);
      expect(ctx.repo.listSubscriptions()).toHaveLength(1);
      expect(ctx.repo.listInvoices()).toHaveLength(1);
      expect(ctx.provider.getCallCount()).toBe(1);
    });

    it('rejects Idempotency-Key reuse with mismatched parameters with 409', async () => {
      const customer = ctx.seedCustomer();
      const firstPayload = aSubscription().forCustomer(customer.id).pro().buildRequest();
      const secondPayload = aSubscription().forCustomer(customer.id).basic().buildRequest();

      const first = await ctx.api.createSubscription(firstPayload, { idempotencyKey: 'idem_conflict_01' });
      const conflict = await ctx.api.createSubscription(secondPayload, { idempotencyKey: 'idem_conflict_01' });

      expect(first.status).toBe(201);
      expect(conflict.status).toBe(409);
      expect(ctx.repo.listSubscriptions()).toHaveLength(1);
      expect(ctx.provider.getCallCount()).toBe(0);
    });

    it('rejects unknown plan with 400 and performs zero DB/provider side effects', async () => {
      const customer = ctx.seedCustomer();
      const res = await ctx.api.createSubscription({
        customer_id: customer.id,
        plan: 'enterprise_invalid',
        payment_method_id: customer.payment_methods[0]
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(ctx.repo.listSubscriptions()).toHaveLength(0);
      expect(ctx.repo.listInvoices()).toHaveLength(0);
      expect(ctx.provider.getCallCount()).toBe(0);
    });

    it('rejects missing required fields with 400 and no provider calls', async () => {
      const res = await ctx.api.createSubscription({ customer_id: 'cust_001' });

      expect(res.status).toBe(400);
      expect(ctx.repo.listSubscriptions()).toHaveLength(0);
      expect(ctx.provider.getCallCount()).toBe(0);
    });

    it('rejects unknown customer with 404 and no provider calls', async () => {
      const res = await ctx.api.createSubscription(
        aSubscription().forCustomer('cust_unknown').pro().buildRequest()
      );

      expect(res.status).toBe(404);
      expect(ctx.repo.listSubscriptions()).toHaveLength(0);
      expect(ctx.provider.getCallCount()).toBe(0);
    });

    it('rejects invalid payment method for customer with 400 and no provider calls', async () => {
      const customer = ctx.seedCustomer();
      const res = await ctx.api.createSubscription(
        aSubscription().forCustomer(customer.id).withPaymentMethod('pm_not_owned').buildRequest()
      );

      expect(res.status).toBe(400);
      expect(ctx.repo.listSubscriptions()).toHaveLength(0);
      expect(ctx.provider.getCallCount()).toBe(0);
    });
  });

  describe('GET /subscriptions/:id & POST /subscriptions/:id/cancel', () => {
    it('returns 404 for unknown subscription id on GET and cancel', async () => {
      const getRes = await ctx.api.getSubscription('sub_does_not_exist');
      const cancelRes = await ctx.api.cancelSubscription('sub_does_not_exist');

      expect(getRes.status).toBe(404);
      expect(cancelRes.status).toBe(404);
    });

    it('cancels an active subscription and rejects double cancellation with 409 without mutating audit log', async () => {
      const customer = ctx.seedCustomer();
      const sub = await ctx.createSubscriptionViaApi(customer, 'basic');

      const firstCancel = await ctx.api.cancelSubscription(sub.id);
      expect(firstCancel.status).toBe(200);
      expect(firstCancel.body.status).toBe('canceled');
      await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);

      const logsAfterFirstCancel = ctx.repo.findAuditLogsBySubscriptionId(sub.id).length;

      const secondCancel = await ctx.api.cancelSubscription(sub.id);
      expect(secondCancel.status).toBe(409);
      expect(ctx.repo.findAuditLogsBySubscriptionId(sub.id)).toHaveLength(logsAfterFirstCancel);
      expectAuditTrail(ctx.repo, sub.id, [
        { from: null, to: 'trialing' },
        { from: 'trialing', to: 'active' },
        { from: 'active', to: 'canceled' }
      ]);
    });
  });

  describe('POST /webhooks/payment-provider request validation', () => {
    it('returns 401 when X-Provider-Signature header is missing and persists nothing', async () => {
      const customer = ctx.seedCustomer();
      const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

      const res = await ctx.api.sendWebhook(
        aWebhook().paymentSucceeded().forSubscription(sub.id).unsigned()
      );

      expect(res.status).toBe(401);
      expect(ctx.repo.listWebhookEvents()).toHaveLength(0);
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('trialing');
    });

    it('returns 401 when X-Provider-Signature is forged and persists nothing', async () => {
      const customer = ctx.seedCustomer();
      const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

      const res = await ctx.api.sendWebhook(
        aWebhook().paymentSucceeded().forSubscription(sub.id).forged()
      );

      expect(res.status).toBe(401);
      expect(ctx.repo.listWebhookEvents()).toHaveLength(0);
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('trialing');
    });

    it('returns 400 for signed malformed JSON payload and persists nothing', async () => {
      const res = await ctx.api.sendWebhook(aWebhook().malformed('{broken-json'));

      expect(res.status).toBe(400);
      expect(ctx.repo.listWebhookEvents()).toHaveLength(0);
    });

    it('returns 400 for signed payload missing required fields', async () => {
      const res = await ctx.api.sendWebhook(
        aWebhook().malformed(JSON.stringify({ event_id: 'evt_incomplete' }))
      );

      expect(res.status).toBe(400);
      expect(ctx.repo.listWebhookEvents()).toHaveLength(0);
    });
  });
});
