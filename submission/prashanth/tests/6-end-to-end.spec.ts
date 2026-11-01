import { test, expect } from './fixtures';
import { aSubscriptionRequest, aWebhook } from './helpers/builders';

test.describe('End-to-end customer journeys', () => {
  test('signup -> trial -> paid -> renewal fails -> recovers -> cancels -> late webhook ignored', async ({ api, webhook, given, clock, paymentProvider, db }) => {
    const customer = given.newCustomer();
    let subId = '';

    await test.step('customer signs up for basic (14-day trial)', async () => {
      const res = await api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('basic').build());
      subId = res.body.id;
      expect(res.body.status).toBe('trialing');
    });

    await test.step('trial ends, first payment succeeds', async () => {
      clock.advanceDays(14);
      expect((await api.charge(subId)).body.subscription.status).toBe('active');
    });

    await test.step('next month: provider times out, then webhook says it failed', async () => {
      clock.advanceDays(30);
      paymentProvider.willTimeout();
      const renewal = await api.charge(subId);
      expect(renewal.body.outcome).toBe('unknown');
      await webhook.send(aWebhook().paymentFailed().forInvoice(renewal.body.invoice).build());
      expect(db.getSubscription(subId)?.status).toBe('past_due');
    });

    await test.step('retry 3 days later succeeds', async () => {
      clock.advanceDays(3);
      expect((await api.charge(subId)).body.subscription.status).toBe('active');
    });

    await test.step('customer cancels; a late success webhook does not revive it', async () => {
      await api.cancel(subId);
      const [firstInvoice] = (await api.getInvoices(subId)).body;
      await webhook.send(aWebhook().paymentSucceeded().forInvoice(firstInvoice).build());
      expect((await api.getSubscription(subId)).body.status).toBe('canceled');
    });

    await test.step('check the full story', async () => {
      expect(db.auditOf(subId).filter((a) => a.to).map((a) => a.to)).toEqual(['trialing', 'active', 'past_due', 'active', 'canceled']);
      expect(paymentProvider.calls.map((c) => c.amount)).toEqual([1900, 1900, 1900]);
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
    await api.charge(sub.id); // fail 1 -> past_due
    await api.charge(sub.id); // fail 2
    await api.charge(sub.id); // fail 3 -> canceled

    expect(db.getSubscription(sub.id)?.status).toBe('canceled');
    expect(db.invoicesOf(sub.id).map((i) => i.status)).toEqual(['paid', 'failed', 'failed', 'failed']);
    expect((await api.charge(sub.id)).status).toBe(409);
    expect(paymentProvider.calls).toHaveLength(4);
  });
});
