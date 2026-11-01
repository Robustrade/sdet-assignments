import { test, expect } from './fixtures';
import { findBrokenRules } from './helpers/businessRules';

test.describe('API and database always agree', () => {
  test('at EVERY step of a full lifecycle, the API and database match', async ({ api, given, db, clock, paymentProvider }) => {
    const { sub } = await given.trialingBasic();

    const checkApiMatchesDatabase = async () => {
      const fromApi = (await api.getSubscription(sub.id)).body;
      const fromDb = db.getSubscription(sub.id)!;
      expect(fromApi.status).toBe(fromDb.status);
      expect(fromApi.canceled_at).toBe(fromDb.canceledAt);
      const apiInvoices = (await api.getInvoices(sub.id)).body;
      expect(apiInvoices.map((i: any) => [i.id, i.status, i.amount])).toEqual(
        db.invoicesOf(sub.id).map((i) => [i.id, i.status, i.amount]),
      );
      expect(findBrokenRules(db)).toEqual([]);
    };

    await test.step('trialing', checkApiMatchesDatabase);
    clock.advanceDays(14);
    await api.charge(sub.id);
    await test.step('active after first payment', checkApiMatchesDatabase);
    paymentProvider.willDecline();
    clock.advanceDays(30);
    await api.charge(sub.id);
    await test.step('past_due after renewal failed', checkApiMatchesDatabase);
    await api.charge(sub.id);
    await test.step('active again after retry', checkApiMatchesDatabase);
    await api.cancel(sub.id);
    await test.step('canceled', checkApiMatchesDatabase);

    expect(db.invoicesOf(sub.id).map((i) => `${i.attempt}:${i.status}`)).toEqual(['1:paid', '2:failed', '3:paid']);
  });

  test('audit history: CREATED -> PAYMENT_SUCCEEDED -> CANCEL', async ({ api, given, db }) => {
    const { sub } = await given.basicWithTrialEnded();
    await api.charge(sub.id);
    await api.cancel(sub.id);
    expect(db.auditOf(sub.id).map((a) => `${a.event}:${a.from}->${a.to}`)).toEqual([
      'CREATED:null->trialing',
      'PAYMENT_SUCCEEDED:trialing->active',
      'CANCEL:active->canceled',
    ]);
  });

  test('webhook events are stored, including ignored ones with the reason', async ({ webhook, given, db }) => {
    const { invoice } = await given.activePro();
    const event = { event_id: 'evt_ignored_1', type: 'payment.succeeded', subscription_id: invoice.subscription_id, invoice_id: invoice.id, amount: 4900, currency: 'USD' };
    await webhook.send(event);
    expect(db.getWebhookEvent('evt_ignored_1')).toMatchObject({ result: 'ignored', reason: 'invoice_already_paid', timesReceived: 1 });
  });

  test('the database refuses a duplicate idempotency key', async ({ given, db }) => {
    const { invoice } = await given.activePro();
    const row = db.getInvoice(invoice.id)!;
    expect(() => db.addInvoice({ ...row, id: 'inv_copy' })).toThrow('Duplicate idempotency key');
  });

  test('the business-rule check really catches broken data (it is not a fake check)', async ({ given, db }) => {
    const { sub, invoice } = await given.activePro();
    db.corruptForTest(invoice.id, 'failed'); // break it on purpose
    expect(findBrokenRules(db)).toContain(`${sub.id} is active but has no successful payment`);
    db.corruptForTest(invoice.id, 'paid'); // put it back so the automatic after-test check passes
  });
});
