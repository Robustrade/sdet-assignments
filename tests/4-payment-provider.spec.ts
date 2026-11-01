import { test, expect } from './fixtures';
import { aSubscriptionRequest, aWebhook } from './helpers/builders';

test.describe('Payment provider (mocked)', () => {
  test('charged exactly once, with exactly the right details', async ({ api, given, paymentProvider, db }) => {
    const customer = given.newCustomer();
    const res = await api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());
    const [invoice] = db.invoicesOf(res.body.id);

    expect(paymentProvider.calls).toEqual([
      {
        subscriptionId: res.body.id,
        invoiceId: invoice.id,
        customerId: customer.id,
        paymentMethodId: 'pm_visa_4242',
        amount: 4900,
        currency: 'USD',
        idempotencyKey: `${res.body.id}-attempt-1`,
      },
    ]);
  });

  test('every billing attempt = exactly one call with a NEW idempotency key', async ({ api, given, paymentProvider }) => {
    const { sub } = await given.activePro();
    paymentProvider.willDecline().willSucceed();
    await api.charge(sub.id);
    await api.charge(sub.id);
    expect(paymentProvider.calls.map((c) => c.idempotencyKey)).toEqual([
      `${sub.id}-attempt-1`,
      `${sub.id}-attempt-2`,
      `${sub.id}-attempt-3`,
    ]);
  });

  test('declined card: past_due, failed invoice with reason, no successful payment saved', async ({ api, given, paymentProvider, db }) => {
    const customer = given.newCustomer();
    paymentProvider.willDecline('do_not_honor');
    const res = await api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());

    expect(res.body.status).toBe('past_due');
    expect(db.invoicesOf(res.body.id)).toEqual([expect.objectContaining({ status: 'failed', note: 'do_not_honor' })]);
  });

  test('timeout: we do not know if they paid, so nothing changes and the invoice stays pending', async ({ given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    expect(db.getSubscription(sub.id)?.status).toBe('trialing');
    expect(invoice).toMatchObject({ status: 'pending', note: 'provider_timeout' });
  });

  test('timeout: charging again is blocked, so the customer is never charged twice', async ({ api, given, paymentProvider }) => {
    const { sub } = await given.proWithPaymentInProgress();
    const res = await api.charge(sub.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('payment_in_progress');
    expect(paymentProvider.calls).toHaveLength(1);
  });

  test('timeout: the webhook settles it, then billing continues normally', async ({ api, webhook, given, paymentProvider }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    await webhook.send(aWebhook().paymentSucceeded().forInvoice(invoice).build());
    expect((await api.charge(sub.id)).status).toBe(200);
    expect(paymentProvider.calls).toHaveLength(2);
  });
});
