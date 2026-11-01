import { test, expect } from './fixtures';
import { aSubscriptionRequest, aWebhook } from './helpers/builders';
import { ApiClient } from './helpers/clients';
import { Database } from '../src/database';

/** After every step of a journey, the API and the database must tell the same story. */
async function expectApiAndDbToAgree(api: ApiClient, db: Database, subId: string, expectedStatus: string) {
  const fromApi = (await api.getSubscription(subId)).body;
  expect(fromApi.status).toBe(expectedStatus);
  expect(db.getSubscription(subId)?.status).toBe(expectedStatus);
  const apiInvoices = (await api.getInvoices(subId)).body.map((i: any) => `${i.id}:${i.status}`);
  expect(apiInvoices).toEqual(db.invoicesOf(subId).map((i) => `${i.id}:${i.status}`));
}

test.describe('End-to-end customer journeys', () => {
  test('signup -> trial -> paid -> renewal fails -> recovers -> cancels -> late webhook ignored', async ({ api, webhook, given, clock, paymentProvider, db }) => {
    const customer = given.newCustomer();
    let subId = '';

    await test.step('customer signs up for basic (14-day trial)', async () => {
      const res = await api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('basic').build());
      subId = res.body.id;
      await expectApiAndDbToAgree(api, db, subId, 'trialing');
    });

    await test.step('trial ends, first payment succeeds', async () => {
      clock.advanceDays(14);
      await api.charge(subId);
      await expectApiAndDbToAgree(api, db, subId, 'active');
    });

    await test.step('next month: provider times out, then webhook says it failed', async () => {
      clock.advanceDays(30);
      paymentProvider.willTimeout();
      const renewal = await api.charge(subId);
      expect(renewal.body.outcome).toBe('unknown');
      await expectApiAndDbToAgree(api, db, subId, 'active'); // unknown result: nothing changes yet
      await webhook.send(aWebhook().paymentFailed().forInvoice(renewal.body.invoice).build());
      await expectApiAndDbToAgree(api, db, subId, 'past_due');
    });

    await test.step('retry 3 days later succeeds', async () => {
      clock.advanceDays(3);
      await api.charge(subId);
      await expectApiAndDbToAgree(api, db, subId, 'active');
    });

    await test.step('customer cancels; a late success webhook does not revive it', async () => {
      await api.cancel(subId);
      const [firstInvoice] = (await api.getInvoices(subId)).body;
      const late = await webhook.send(aWebhook().paymentSucceeded().forInvoice(firstInvoice).build());
      expect(late.body).toEqual({ status: 'ignored', reason: 'subscription_canceled' }); // ignored for the RIGHT reason
      await expectApiAndDbToAgree(api, db, subId, 'canceled');
    });

    await test.step('a canceled subscription cannot be charged again', async () => {
      expect((await api.charge(subId)).status).toBe(409);
      expect(paymentProvider.calls).toHaveLength(3); // no new charge after cancel
    });

    await test.step('check the full story', async () => {
      expect(db.auditOf(subId).filter((a) => a.to).map((a) => a.to)).toEqual(['trialing', 'active', 'past_due', 'active', 'canceled']);
      expect(paymentProvider.calls.map((c) => c.amount)).toEqual([1900, 1900, 1900]);
      // every billing attempt used its own idempotency key
      expect(paymentProvider.calls.map((c) => c.idempotencyKey)).toEqual([
        `${subId}-attempt-1`,
        `${subId}-attempt-2`,
        `${subId}-attempt-3`,
      ]);
      expect(db.invoicesOf(subId).map((i) => i.status)).toEqual(['paid', 'failed', 'paid']);
      expect(db.outboxOf(subId).map((o) => o.message)).toEqual([
        'status changed to active',
        'status changed to past_due',
        'status changed to active',
        'status changed to canceled',
      ]);
    });
  });

  test('all retries fail -> canceled automatically, and never charged again', async ({ api, given, paymentProvider, db }) => {
    const { sub } = await given.activePro();
    paymentProvider.alwaysDecline();

    await test.step('3 failed payments in a row', async () => {
      await api.charge(sub.id); // fail 1 -> past_due
      await expectApiAndDbToAgree(api, db, sub.id, 'past_due');
      await api.charge(sub.id); // fail 2 -> still past_due (retries left)
      await expectApiAndDbToAgree(api, db, sub.id, 'past_due');
      await api.charge(sub.id); // fail 3 -> canceled
      await expectApiAndDbToAgree(api, db, sub.id, 'canceled');
    });

    await test.step('canceled for the right reason, and never charged again', async () => {
      expect(db.auditOf(sub.id).map((a) => a.event)).toContain('RETRIES_EXHAUSTED');
      expect(db.invoicesOf(sub.id).map((i) => i.status)).toEqual(['paid', 'failed', 'failed', 'failed']);
      expect((await api.charge(sub.id)).status).toBe(409);
      expect(paymentProvider.calls).toHaveLength(4);
      // customer was told once per real status change (active, past_due, canceled), not once per failed retry
      expect(db.outboxOf(sub.id).map((o) => o.message)).toEqual([
        'status changed to active',
        'status changed to past_due',
        'status changed to canceled',
      ]);
    });
  });

  test('provider is slow and repeats itself: duplicate webhooks mid-journey change nothing extra', async ({ api, webhook, given, clock, paymentProvider, db }) => {
    const { sub } = await given.activePro();

    await test.step('renewal times out (result unknown)', async () => {
      clock.advanceDays(30);
      paymentProvider.willTimeout();
      const renewal = await api.charge(sub.id);
      expect(renewal.body.outcome).toBe('unknown');

      await test.step('provider sends the same success webhook 3 times', async () => {
        const event = aWebhook().paymentSucceeded().forInvoice(renewal.body.invoice).build();
        const results = [await webhook.send(event), await webhook.send(event), await webhook.send(event)];
        expect(results.map((r) => r.body.status)).toEqual(['applied', 'duplicate', 'duplicate']);
      });
    });

    await test.step('only one renewal recorded, no extra email, no extra charge', async () => {
      await expectApiAndDbToAgree(api, db, sub.id, 'active');
      expect(db.invoicesOf(sub.id).map((i) => i.status)).toEqual(['paid', 'paid']);
      expect(db.auditOf(sub.id).filter((a) => a.event === 'PAYMENT_SUCCEEDED')).toHaveLength(2); // signup + renewal, not 4
      expect(db.outboxOf(sub.id)).toHaveLength(1); // only "active" at signup; renewal keeps status active
      expect(paymentProvider.calls).toHaveLength(2); // webhooks never trigger charges
    });
  });
});