import { beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../support/TestContext';
import { aWebhook } from '../support/builders';
import {
  expectApiMatchesDb,
  expectAuditTrail,
  expectNeverActiveWithoutPaidInvoice,
  expectNoDuplicateInvoices,
  expectProviderCalledWith
} from '../support/assertions';

describe('End-to-End Subscription Billing Journeys', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = TestContext.create({ maxRetries: 3 });
  });

  it('completes full lifecycle: pro trial -> active -> recurring fail -> retry recovery -> cancel -> stray webhook ignored', async () => {
    const customer = ctx.seedCustomer();

    // 1. Start pro subscription in trialing
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');
    expect(sub.status).toBe('trialing');
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);

    // 2. Trial ends, first charge succeeds -> active
    ctx.provider.queueOutcomes('success', 'declined', 'success');
    const trialBill = await ctx.api.billSubscription(sub.id);
    expect(trialBill.body.subscription.status).toBe('active');
    expectProviderCalledWith(ctx.provider, {
      customerId: customer.id,
      amount: 4900,
      paymentMethodId: customer.payment_methods[0],
      callIndex: 0
    });
    expectNeverActiveWithoutPaidInvoice(ctx.repo, sub.id);

    // 3. Recurring charge declines -> past_due
    const recurringFail = await ctx.api.billSubscription(sub.id);
    expect(recurringFail.body.subscription.status).toBe('past_due');
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);

    // 4. Retry succeeds -> active
    const retryBill = await ctx.api.billSubscription(sub.id);
    expect(retryBill.body.subscription.status).toBe('active');
    expect(retryBill.body.subscription.retry_count).toBe(0);
    expectNoDuplicateInvoices(ctx.repo, sub.id, 3);

    // 5. Customer cancels -> canceled
    const cancelRes = await ctx.api.cancelSubscription(sub.id);
    expect(cancelRes.body.status).toBe('canceled');
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);

    // 6. Late webhook cannot resurrect canceled subscription
    const lateWebhook = await ctx.api.sendWebhook(
      aWebhook().paymentSucceeded().forSubscription(sub.id).withAmount(4900).signed()
    );
    expect(lateWebhook.body.status).toBe('ignored');
    expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('canceled');

    expectAuditTrail(ctx.repo, sub.id, [
      { from: null, to: 'trialing' },
      { from: 'trialing', to: 'active' },
      { from: 'active', to: 'past_due' },
      { from: 'past_due', to: 'active' },
      { from: 'active', to: 'canceled' }
    ]);
  });

  it('exhausts retries on repeated webhook failures and transitions past_due -> canceled', async () => {
    const customer = ctx.seedCustomer();
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

    // Attempt 1 (trial fails -> past_due, retry_count = 1)
    await ctx.api.sendWebhook(
      aWebhook().withEventId('evt_try_1').paymentFailed().forSubscription(sub.id).withAmount(4900).signed()
    );
    expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('past_due');
    expect(ctx.repo.findSubscriptionById(sub.id)!.retry_count).toBe(1);

    // Attempt 2 (retry fails -> still past_due, retry_count = 2)
    await ctx.api.sendWebhook(
      aWebhook().withEventId('evt_try_2').paymentFailed().forSubscription(sub.id).withAmount(4900).signed()
    );
    expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('past_due');
    expect(ctx.repo.findSubscriptionById(sub.id)!.retry_count).toBe(2);

    // Attempt 3 (retries exhausted -> canceled, retry_count = 3)
    await ctx.api.sendWebhook(
      aWebhook().withEventId('evt_try_3').paymentFailed().forSubscription(sub.id).withAmount(4900).signed()
    );
    expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('canceled');
    expect(ctx.repo.findSubscriptionById(sub.id)!.retry_count).toBe(3);

    expectNoDuplicateInvoices(ctx.repo, sub.id, 3);
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    expectAuditTrail(ctx.repo, sub.id, [
      { from: null, to: 'trialing' },
      { from: 'trialing', to: 'past_due' },
      { from: 'past_due', to: 'canceled' }
    ]);
  });
});
