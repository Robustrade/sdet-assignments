import { describe, expect, it } from 'vitest';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment } from '../../framework/env/TestEnvironment';

describe('Payment provider interaction', () => {
  const env = useTestEnvironment();

  it('charges exactly the plan price, customer and payment method, with a per-attempt idempotency key', async () => {
    const customer = env().seedCustomer();
    env().provider.willSucceed();

    const res = await env().api.create(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());

    const [invoice] = env().db.invoicesFor(res.body.id);
    expect(env().provider.calls).toEqual([
      {
        customerId: customer.id,
        paymentMethodId: customer.paymentMethodId,
        amount: 4900,
        currency: 'USD',
        idempotencyKey: `${invoice!.id}:attempt:1`,
        metadata: { subscriptionId: res.body.id, invoiceId: invoice!.id },
      },
    ]);
  });

  it('charges the basic price when a basic trial ends', async () => {
    const sub = await env().given.trialingSubscription('basic');
    env().clock.advanceDays(14);
    env().provider.willSucceed();

    await env().api.runBilling(sub.id);

    expect(env().provider.lastCall()).toMatchObject({ amount: 1900, currency: 'USD' });
  });

  it('a retry re-charges the same invoice under a new idempotency key', async () => {
    const sub = await env().given.pastDueSubscription();
    env().provider.willSucceed();

    await env().api.runBilling(sub.id);

    const [first, retry] = env().provider.calls;
    expect(retry!.metadata.invoiceId).toBe(first!.metadata.invoiceId);
    expect(retry!.idempotencyKey).toBe(`${first!.metadata.invoiceId}:attempt:2`);
    expect(retry!.idempotencyKey).not.toBe(first!.idempotencyKey);
  });

  it('is not called before the trial has ended', async () => {
    const sub = await env().given.trialingSubscription('basic');
    env().clock.advanceDays(13);

    const res = await env().api.runBilling(sub.id);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('not_due');
    expect(env().provider.calls).toHaveLength(0);
  });

  it('is not called again while an earlier charge is still unanswered (could double-charge)', async () => {
    const { subscription } = await env().given.subscriptionWithPendingFirstCharge();

    const res = await env().api.runBilling(subscription.id);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('charge_in_flight');
    expect(env().provider.calls).toHaveLength(1);
  });

  it('is not called for a canceled subscription (cancel stops future billing)', async () => {
    const sub = await env().given.activeSubscription();
    await env().api.cancel(sub.id);
    env().clock.advanceDays(30);

    const res = await env().api.runBilling(sub.id);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('subscription_canceled');
    expect(env().provider.calls).toHaveLength(1);
  });

  it('is not called when a webhook is received or replayed', async () => {
    const { charge } = await env().given.subscriptionWithPendingFirstCharge();
    const event = env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build());

    await env().webhooks.deliver(event);
    await env().webhooks.deliver(event);

    expect(env().provider.calls).toHaveLength(1);
  });
});
