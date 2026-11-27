import { aSignupRequest } from '../framework/builders';
import { daysAfterStart, oneMinuteBefore, PLANS } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';

describe('Plan rules applied consistently from signup to billing', () => {
  const env = useHarness();

  it('basic: not billed one minute before the trial ends, billed exactly at trial end', async () => {
    const created = await env().api.createOk(aSignupRequest().onBasicPlan().build());
    const trialEnd = created.trial_ends_at!;

    env().clock.set(oneMinuteBefore(trialEnd));
    await env().runBilling();
    expect(env().gateway.calls).toHaveLength(0);
    expect(env().stored(created.id).invoices).toHaveLength(0);

    env().clock.set(trialEnd);
    await env().runBilling();
    expect(env().gateway.calls).toHaveLength(1);
  });

  it.each([
    { plan: 'basic', price: 1900 },
    { plan: 'pro', price: 4900 },
  ])('$plan: subscription price, every invoice and every provider charge use $price', async ({ plan, price }) => {
    env().gateway.alwaysDecline();
    const created = await env().api.createOk(aSignupRequest().onPlan(plan).build());

    await env().advanceDaysAndBill(PLANS.basic.trialDays);
    await env().retryUntilSettled(env().latestInvoiceId(created.id));

    expect(created.amount).toBe(price);
    expect(env().stored(created.id).invoices.map((invoice) => invoice.amountCents)).toEqual([price]);
    expect(env().gateway.calls.length).toBeGreaterThan(1);
    expect(env().gateway.calls.every((call) => call.amountCents === price)).toBe(true);
  });

  it('basic retry schedule: every 3 days, 3 attempts in total', async () => {
    env().gateway.alwaysDecline();
    const created = await env().api.createOk(aSignupRequest().onBasicPlan().build());
    await env().advanceDaysAndBill(PLANS.basic.trialDays);
    const invoiceId = env().latestInvoiceId(created.id);

    const retryTimes = await env().retryUntilSettled(invoiceId);

    const firstChargeDay = PLANS.basic.trialDays;
    expect(retryTimes).toEqual([daysAfterStart(firstChargeDay + 3), daysAfterStart(firstChargeDay + 3 + 3)]);
    expect(env().gateway.callsForInvoice(invoiceId)).toHaveLength(3);
    expect(env().stored(created.id).status).toBe('canceled');
  });

  it('pro retry schedule: back-off of 1, 3, 5 days, 4 attempts in total', async () => {
    env().gateway.alwaysDecline();
    const created = await env().api.createOk(aSignupRequest().onProPlan().build());
    const invoiceId = env().latestInvoiceId(created.id);

    const retryTimes = await env().retryUntilSettled(invoiceId);

    expect(retryTimes).toEqual([daysAfterStart(1), daysAfterStart(1 + 3), daysAfterStart(1 + 3 + 5)]);
    expect(env().gateway.callsForInvoice(invoiceId)).toHaveLength(4);
    expect(env().stored(created.id).status).toBe('canceled');
  });
});
