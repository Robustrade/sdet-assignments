import { describe, expect, it } from 'vitest';
import { aPaymentWebhook } from '../support/builders/webhookEventBuilder';
import { useTestContext } from '../support/testContext';
import { BILLING_PERIOD_DAYS } from '../support/testData';

/** E1: each of the 7 allowed transitions, driven the way it happens for real. */
describe('E1. every allowed transition', () => {
  const ctx = useTestContext();

  it('trialing -> active: the trial ends and the first charge succeeds', async () => {
    const { steps, dbCheck } = ctx();
    const subscription = await steps.trialingPro();

    await steps.endTrial();

    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.lastTransition(subscription.id)).toEqual({
      from: 'trialing',
      to: 'active',
      trigger: 'charge_succeeded',
      source: 'billing',
    });
  });

  it('trialing -> active can also come from a payment.succeeded webhook', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();

    const response = await webhooks.deliver(aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build());

    expect(response.data().outcome).toBe('processed');
    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.lastTransition(subscription.id)).toEqual({
      from: 'trialing',
      to: 'active',
      trigger: 'charge_succeeded',
      source: 'webhook',
    });
  });

  it('trialing -> past_due: the trial ends and the first charge is declined', async () => {
    const { steps, provider, dbCheck } = ctx();
    const subscription = await steps.trialingPro();
    provider.respondWith('decline');

    await steps.endTrial();

    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.lastTransition(subscription.id)).toMatchObject({ from: 'trialing', to: 'past_due', trigger: 'charge_failed' });
  });

  it('active -> past_due: the renewal charge is declined', async () => {
    const { steps, provider, dbCheck } = ctx();
    const subscription = await steps.activeBasic();
    provider.respondWith('decline');

    await steps.advanceAndBill(BILLING_PERIOD_DAYS);

    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.lastTransition(subscription.id)).toMatchObject({ from: 'active', to: 'past_due', trigger: 'charge_failed' });
  });

  it('past_due -> active: a retry succeeds', async () => {
    const { steps, provider, dbCheck } = ctx();
    const subscription = await steps.pastDueBasic();
    provider.respondWith('succeed');

    await steps.advanceAndBill(1);

    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.lastTransition(subscription.id)).toMatchObject({
      from: 'past_due',
      to: 'active',
      trigger: 'charge_succeeded',
    });
  });

  it('past_due -> canceled: retries run out', async () => {
    const { steps, provider, clock, dbCheck } = ctx();
    const subscription = await steps.pastDueBasic();
    provider.respondWith('decline', 'decline');

    await steps.advanceAndBill(1);
    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    await steps.advanceAndBill(1);

    const canceled = await steps.current(subscription.id);
    expect(canceled.status).toBe('canceled');
    expect(canceled.canceled_at).toBe(clock.now().toISOString());
    expect(dbCheck.lastTransition(subscription.id)).toEqual({
      from: 'past_due',
      to: 'canceled',
      trigger: 'retries_exhausted',
      source: 'billing',
    });
  });

  it('active -> canceled: the customer cancels through the API', async () => {
    const { steps, api, clock, dbCheck } = ctx();
    const subscription = await steps.activeBasic();

    const response = await api.cancelSubscription(subscription.id);

    expect(response.status).toBe(200);
    expect(response.data()).toMatchObject({ status: 'canceled', canceled_at: clock.now().toISOString() });
    dbCheck.expectMatchesApi(response.data());
    expect(dbCheck.lastTransition(subscription.id)).toEqual({
      from: 'active',
      to: 'canceled',
      trigger: 'cancel_requested',
      source: 'api',
    });
  });

  it('trialing -> canceled: the customer cancels during the trial', async () => {
    const { steps, api, dbCheck, providerCheck } = ctx();
    const subscription = await steps.trialingPro();

    const response = await api.cancelSubscription(subscription.id);

    expect(response.status).toBe(200);
    expect(response.data().status).toBe('canceled');
    expect(dbCheck.lastTransition(subscription.id)).toMatchObject({ from: 'trialing', to: 'canceled', trigger: 'cancel_requested' });
    providerCheck.expectNoCharges();
  });
});
