import { beforeEach, describe, expect, it } from 'vitest';
import { aCreateSubscriptionRequest } from '../support/builders/SubscriptionRequestBuilder.js';
import { aWebhookEvent } from '../support/builders/WebhookEventBuilder.js';
import { TestEnvironment } from '../support/TestEnvironment.js';

describe('Payment provider interaction (mock)', () => {
  let env: TestEnvironment;
  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('exactly one charge per genuine billing attempt, with the right arguments', () => {
    it('basic plan: creation charges once with the plan amount, customer, payment method and a reference', async () => {
      const res = await env.api.createSubscription(
        aCreateSubscriptionRequest().onPlan('basic').forCustomer('cust_001').withPaymentMethod('pm_test_visa_4242').build(),
      );

      const invoice = env.invoices.latest(res.body.id);
      env.charges.expectChargeCount(1);
      env.charges.expectLastCharge({
        customerId: 'cust_001',
        paymentMethodId: 'pm_test_visa_4242',
        amount: 1900,
        currency: 'USD',
        idempotencyKey: `${res.body.id}:${invoice.id}`,
      });
      expect(invoice.status).toBe('paid');
      expect(invoice.providerChargeId).toBe('ch_fake_1');
    });

    it('pro plan: creation makes NO charge; the charge happens when the trial ends', async () => {
      const res = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('pro').build());
      env.charges.expectNoCharges();

      await env.api.billSubscription(res.body.id);

      env.charges.expectChargeCount(1);
      expect(env.provider.lastCall?.amount).toBe(4900);
    });

    it('three billing attempts produce exactly three charges and three invoices', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('active').create();

      await env.api.billSubscription(sub.id);
      await env.api.billSubscription(sub.id);
      await env.api.billSubscription(sub.id);

      env.charges.expectChargeCount(3);
      expect(env.invoices.forSubscription(sub.id)).toHaveLength(4); // 1 from setup + 3
    });

    it('a retry after a decline uses a NEW invoice and a different idempotency key', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      env.provider.enqueue('decline', 'succeed');

      await env.api.billSubscription(sub.id);
      await env.api.billSubscription(sub.id);

      expect(env.provider.calls).toHaveLength(2);
      expect(env.provider.calls[0].idempotencyKey).not.toBe(env.provider.calls[1].idempotencyKey);
      expect(env.provider.calls[0].amount).toBe(env.provider.calls[1].amount);
    });
  });

  describe('behaviour for each provider outcome', () => {
    it('success: invoice paid, subscription active', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      env.provider.alwaysSucceed();

      await env.api.billSubscription(sub.id);

      expect(env.invoices.latest(sub.id).status).toBe('paid');
      expect(env.subscriptions.get(sub.id)?.status).toBe('active');
      await env.verify.assertConsistent(sub.id);
    });

    it('decline: invoice failed with a reason, no paid record, subscription past_due (not active, not canceled)', async () => {
      env.provider.alwaysDecline();
      const res = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('basic').build());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('past_due');
      const invoices = env.invoices.forSubscription(res.body.id);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe('failed');
      expect(invoices[0].failureReason).toBe('card_declined');
      expect(invoices[0].paidAt).toBeNull();
      env.charges.expectChargeCount(1);
      await env.verify.assertConsistent(res.body.id);
    });

    it('timeout: outcome unknown, so the invoice stays pending and the status is unchanged', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      env.provider.alwaysTimeout();

      const res = await env.api.billSubscription(sub.id);

      expect(res.status).toBe(200);
      expect(res.body.subscription.status).toBe('trialing');
      expect(res.body.invoice.status).toBe('pending');
      env.charges.expectChargeCount(1);
      expect(env.invoices.latest(sub.id).paidAt).toBeNull();
      await env.verify.assertConsistent(sub.id);
    });
  });

  describe('the provider is NOT called when no charge is needed', () => {
    const rejected = [
      ['unknown plan', () => aCreateSubscriptionRequest().onPlan('platinum').build()],
      ['unknown customer', () => aCreateSubscriptionRequest().forCustomer('cust_ghost').build()],
      ['missing payment method', () => aCreateSubscriptionRequest().without('payment_method_id').build()],
    ] as const;
    for (const [label, makeRequest] of rejected) {
      it(`rejected creation (${label}) makes no charge`, async () => {
        await env.api.createSubscription(makeRequest());
        env.charges.expectNoCharges();
      });
    }

    it('cancellation makes no charge', async () => {
      const sub = await env.aSubscription().onPlan('basic').inState('active').create();
      await env.api.cancelSubscription(sub.id);
      env.charges.expectNoCharges();
    });

    it('processing a webhook, and replaying it, makes no charge', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
      const invoice = await env.leavePendingInvoice(sub.id);
      const event = aWebhookEvent().succeeded().forInvoice(invoice).build();

      await env.webhooks.deliver(event);
      await env.webhooks.deliver(event);

      env.charges.expectNoCharges();
    });

    it('billing a canceled subscription is refused before reaching the provider', async () => {
      const sub = await env.aSubscription().onPlan('pro').inState('canceled').create();
      await env.api.billSubscription(sub.id);
      env.charges.expectNoCharges();
    });
  });
});
