import { describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../framework/builders/subscription-request-builder';
import { WebhookEventBuilder } from '../framework/builders/webhook-event-builder';
import { ProviderAssertions } from '../framework/assertions/provider-assertions';
import { SubscriptionAssertions } from '../framework/assertions/subscription-assertions';
import { useBillingSystem } from '../framework/harness/suite';

/**
 * LEVEL 5 — end-to-end flows, driven entirely over HTTP.
 *
 * Each test follows one journey from the API request or webhook delivery,
 * through service processing, to persistence and provider interaction, and
 * asserts all four layers agree at every step.
 */
describe('End-to-end billing journeys', () => {
  const suite = useBillingSystem();

  it('dunning: trial -> failed charge -> exhausted retries -> canceled', async () => {
    const created = await suite.env.api.create(
      SubscriptionRequestBuilder.aRequest().onPlan('basic').build()
    );
    expect(created.status).toBe(201);
    const id = created.body.id;

    suite.env.provider.alwaysDeclines('insufficient_funds');
    suite.env.advanceDays(7); // trial ends, declined
    await suite.env.api.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, id).hasState('past_due');

    suite.env.advanceDays(3); // retry 1, declined
    await suite.env.api.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, id).hasState('past_due');

    suite.env.advanceDays(3); // retry 2, declined -> budget exhausted
    await suite.env.api.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, id).hasState('canceled');

    SubscriptionAssertions.for(suite.env, id)
      .hasTransitionTrail(
        'TRIAL_ENDS_CHARGE_FAILED',
        'PAST_DUE_RETRY_FAILED_AGAIN',
        'PAST_DUE_RETRIES_EXHAUSTED'
      )
      .hasInvoiceStatuses('failed', 'failed', 'failed')
      .hasPaidInvoiceCount(0)
      .hasNotificationCount('payment_failed', 2)
      .hasNotificationCount('subscription_canceled', 1);

    ProviderAssertions.on(suite.env.provider)
      .wasCalledTimesForSubscription(id, 3)
      .usedUniqueIdempotencyKeys()
      .lastChargeMatched({ amountCents: 1900, attempt: 3 });

    // Terminal means terminal: a late success webhook changes nothing.
    const lastInvoice = await suite.env.latestInvoice(id);
    const late = await suite.env.webhooks.deliver(
      WebhookEventBuilder.anEvent().succeeded().forInvoice(lastInvoice).build()
    );
    expect(late.body.status).toBe('ignored');
    await SubscriptionAssertions.for(suite.env, id).hasState('canceled');
    SubscriptionAssertions.for(suite.env, id).hasNoTransitionsAfter(3);
  });

  it('asynchronous provider: timeout -> failure webhook -> recovered by the scheduled retry', async () => {
    const created = await suite.env.api.create(
      SubscriptionRequestBuilder.aRequest().onPlan('pro').build()
    );
    const id = created.body.id;

    suite.env.advanceDays(14);
    suite.env.provider.timesOutOnce();
    await suite.env.api.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, id).hasState('trialing');

    // The provider eventually reports that the charge failed.
    const pending = await suite.env.latestInvoice(id);
    const webhookResponse = await suite.env.webhooks.deliver(
      WebhookEventBuilder.anEvent().failed().forInvoice(pending).build()
    );
    expect(webhookResponse.body.status).toBe('processed');
    await SubscriptionAssertions.for(suite.env, id).hasState('past_due');

    suite.env.advanceDays(3);
    suite.env.provider.succeedsOnce();
    await suite.env.api.runBillingCycle();

    await SubscriptionAssertions.for(suite.env, id).hasState('active');
    SubscriptionAssertions.for(suite.env, id)
      .hasTransitionTrail('TRIAL_ENDS_CHARGE_FAILED', 'PAST_DUE_RETRY_SUCCEEDED')
      .hasInvoiceStatuses('failed', 'paid')
      .hasWebhookEventCount(1);
    ProviderAssertions.on(suite.env.provider).wasCalledTimesForSubscription(id, 2);
  });

  it('happy path: immediate charge, renewal, then cancellation stops future billing', async () => {
    suite.env.provider.alwaysSucceeds();

    const created = await suite.env.api.create(
      SubscriptionRequestBuilder.aRequest().onPlan('scale').build()
    );
    const id = created.body.id;
    expect(created.body.state).toBe('active');

    suite.env.advanceDays(30);
    await suite.env.api.runBillingCycle();
    SubscriptionAssertions.for(suite.env, id).hasPaidInvoiceCount(2);

    expect((await suite.env.api.cancel(id)).status).toBe(200);

    suite.env.advanceDays(90);
    const mark = suite.env.provider.mark();
    await suite.env.api.runBillingCycle();

    ProviderAssertions.on(suite.env.provider).wasNotCalledSince(mark);
    await SubscriptionAssertions.for(suite.env, id).hasState('canceled');
    SubscriptionAssertions.for(suite.env, id).hasTransitionTrail(
      'TRIAL_ENDS_CHARGE_SUCCEEDED',
      'ACTIVE_RENEWAL_SUCCEEDED',
      'ACTIVE_CANCELED_BY_API'
    );
  });

  it('runs a mixed portfolio through one billing cycle without cross-contamination', async () => {
    const succeeding = await suite.env.scenarios.trialing({ plan: 'basic' });
    const failing = await suite.env.scenarios.trialing({
      plan: 'basic',
      customerId: 'cust_002',
      paymentMethodId: 'pm_test_mastercard_5555'
    });

    suite.env.advanceDays(7);
    suite.env.provider.willRespond({ kind: 'succeed' }, { kind: 'decline' });
    const report = await suite.env.runBillingCycle();

    expect(report.attempts).toHaveLength(2);
    await SubscriptionAssertions.for(suite.env, succeeding.id).hasState('active');
    await SubscriptionAssertions.for(suite.env, failing.id).hasState('past_due');
    SubscriptionAssertions.for(suite.env, succeeding.id).hasInvoiceStatuses('paid');
    SubscriptionAssertions.for(suite.env, failing.id).hasInvoiceStatuses('failed');
    ProviderAssertions.on(suite.env.provider)
      .wasCalledTimes(2)
      .wasCalledTimesForSubscription(succeeding.id, 1)
      .wasCalledTimesForSubscription(failing.id, 1);
  });
});
