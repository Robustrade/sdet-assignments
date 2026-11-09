import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

/**
 * Mocked payment-provider interaction. These tests prove the service calls the
 * provider exactly once per genuine billing attempt, with the right arguments,
 * and never for actions that don't require a charge.
 */
describe('mocked payment provider interaction', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.setup();
  });

  it('charges exactly once with the correct arguments on immediate-plan creation', async () => {
    env.provider.willReturn('success');

    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('basic').build(),
    );
    const id = created.body.id;
    const invoiceId = env.db.invoices.findBySubscription(id)[0].id;

    verify(env).provider.chargedExactlyOnce().lastChargeMatched({
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amount: 1900,
      currency: 'USD',
      idempotencyKey: invoiceId, // charge reference ties to the invoice
    });
  });

  it('does not charge when creating a trial-plan subscription', async () => {
    await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    verify(env).provider.wasNotCharged();
  });

  it('does not charge when processing an inbound webhook', async () => {
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    const id = created.body.id;

    await env.api.postWebhook(
      env.webhook().withEventId('evt_1').forSubscription(id).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );

    verify(env).provider.wasNotCharged();
  });

  it('does not charge when creation is rejected by validation', async () => {
    await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('enterprise').build(),
    );
    verify(env).provider.wasNotCharged();
  });

  it('declines move the subscription to past_due and record a failed invoice', async () => {
    env.provider.willReturn('decline');

    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('basic').build(),
    );
    const id = created.body.id;

    verify(env).provider.chargedExactlyOnce();
    verify(env).persisted.subscriptionStatus(id, 'past_due').paidInvoiceCount(id, 0);
  });

  it('a provider timeout is treated as a failed charge (past_due), still charged once', async () => {
    env.provider.willReturn('timeout');

    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('basic').build(),
    );
    const id = created.body.id;

    expect(created.status).toBe(201);
    verify(env).provider.chargedExactlyOnce();
    verify(env).persisted
      .subscriptionStatus(id, 'past_due')
      .paidInvoiceCount(id, 0)
      .invoiceCount(id, 1);
  });
});
