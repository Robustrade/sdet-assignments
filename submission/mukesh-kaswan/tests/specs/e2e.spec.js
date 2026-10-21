const { test, expect } = require('../helpers/fixtures');
const { aSubscription, aWebhook } = require('../helpers/builders');

test.describe('End-to-end subscription journey', () => {
  test('create -> trial converts -> renewal fails -> retry succeeds -> cancel -> stray webhook ignored', async ({ api, db, verify }) => {
    let sub;

    await test.step('create basic subscription (trialing, no charge)', async () => {
      sub = await api.createSubscriptionOk(aSubscription().onPlan('basic').build());
      await verify.subscriptionIs(sub.id, 'trialing');
      verify.invoiceStatuses(sub.id, []);
    });

    await test.step('trial ends, first charge succeeds -> active', async () => {
      await api.sendWebhookOk(aWebhook().paymentSucceeded(sub).withInvoiceId('inv_month_1').build());
      await verify.subscriptionIs(sub.id, 'active');
      verify.invoiceStatuses(sub.id, ['paid']);
    });

    await test.step('renewal charge fails -> past_due', async () => {
      await api.sendWebhookOk(aWebhook().paymentFailed(sub).withInvoiceId('inv_month_2').build());
      await verify.subscriptionIs(sub.id, 'past_due');
      verify.invoiceStatuses(sub.id, ['paid', 'failed']);
    });

    await test.step('retry of the same invoice succeeds -> active', async () => {
      await api.sendWebhookOk(aWebhook().paymentSucceeded(sub).withInvoiceId('inv_month_2').build());
      await verify.subscriptionIs(sub.id, 'active');
      verify.invoiceStatuses(sub.id, ['paid', 'paid']);
    });

    await test.step('customer cancels -> canceled', async () => {
      const res = await api.cancelSubscription(sub.id);
      expect(res.status()).toBe(200);
      await verify.subscriptionIs(sub.id, 'canceled');
    });

    await test.step('stray payment.succeeded after cancel is ignored', async () => {
      const result = await api.sendWebhookOk(aWebhook().paymentSucceeded(sub).build());
      expect(result).toEqual({ result: 'ignored_invalid_transition' });
      await verify.subscriptionIs(sub.id, 'canceled');
      verify.invoiceStatuses(sub.id, ['paid', 'paid']);
    });

    await test.step('full history is auditable and coherent', async () => {
      verify.auditTrail(sub.id, ['trialing', 'active', 'past_due', 'active', 'canceled']);
      expect(db.webhookEventsFor(sub.id).map((e) => e.outcome)).toEqual([
        'processed', 'processed', 'processed', 'ignored_invalid_transition',
      ]);
      const timestamps = db.auditFor(sub.id).map((e) => e.at);
      expect(timestamps).toEqual([...timestamps].sort());
      verify.providerNotCalled();
    });
  });
});
