const { test, expect } = require('../helpers/fixtures');
const { aSubscription, aWebhook } = require('../helpers/builders');

// The pro plan has no trial, so creating it charges the provider immediately.
const proRequest = () => aSubscription().onPlan('pro').forCustomer('cust_002').withPaymentMethod('pm_test_mastercard_4444').build();

test.describe('Payment provider (mocked): immediate charge on pro plan', () => {
  test('success: charged once with exact amount, customer, method and idempotency key', async ({ api, provider, db, verify }) => {
    provider.willSucceed();

    const sub = await api.createSubscriptionOk(proRequest());

    const [invoice] = db.invoicesFor(sub.id);
    verify.providerCalledOnceWith({
      customer_id: 'cust_002',
      payment_method_id: 'pm_test_mastercard_4444',
      amount: 4900,
      currency: 'USD',
      idempotency_key: invoice.id,
    });
    expect(invoice).toMatchObject({ amount: 4900, currency: 'USD', status: 'paid', failure_reason: null });
    expect(sub.status).toBe('active');
    await verify.subscriptionIs(sub.id, 'active');
    verify.auditTrail(sub.id, ['trialing', 'active']);
  });

  test('decline: subscription goes to past_due with a failed invoice, never active', async ({ api, provider, verify, db }) => {
    provider.willDecline('insufficient_funds');

    const sub = await api.createSubscriptionOk(proRequest());

    expect(provider.calls).toHaveLength(1);
    await verify.subscriptionIs(sub.id, 'past_due');
    expect(db.invoicesFor(sub.id)).toEqual([expect.objectContaining({ status: 'failed', failure_reason: 'insufficient_funds' })]);
    verify.auditTrail(sub.id, ['trialing', 'past_due']);
  });

  test('timeout: treated as a failed attempt and recorded as provider_timeout', async ({ api, provider, verify, db }) => {
    provider.willTimeout();

    const sub = await api.createSubscriptionOk(proRequest());

    expect(provider.calls).toHaveLength(1);
    await verify.subscriptionIs(sub.id, 'past_due');
    expect(db.invoicesFor(sub.id)).toEqual([expect.objectContaining({ status: 'failed', failure_reason: 'provider_timeout' })]);
  });

  test('timeout followed by a late payment.succeeded webhook activates without charging again', async ({ api, provider, db, verify }) => {
    provider.willTimeout();
    const sub = await api.createSubscriptionOk(proRequest());
    const [invoice] = db.invoicesFor(sub.id);

    // The charge actually went through at the provider; it tells us via webhook.
    await api.sendWebhookOk(aWebhook().paymentSucceeded(sub).withInvoiceId(invoice.id).build());

    await verify.subscriptionIs(sub.id, 'active');
    verify.invoiceStatuses(sub.id, ['paid']);
    expect(provider.calls).toHaveLength(1);
  });
});

test.describe('Payment provider (mocked): not called when no charge is needed', () => {
  test('creating a basic (trial) subscription does not charge', async ({ given, verify }) => {
    await given.trialingSubscription();

    verify.providerNotCalled();
  });

  test('processing and replaying webhooks never calls the provider', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();
    const webhook = aWebhook().paymentSucceeded(sub).build();

    await api.sendWebhookOk(webhook);
    await api.sendWebhookOk(webhook);

    verify.providerNotCalled();
  });

  test('canceling does not call the provider', async ({ api, given, verify }) => {
    const sub = await given.activeSubscription();

    await api.cancelSubscription(sub.id);

    verify.providerNotCalled();
  });
});
