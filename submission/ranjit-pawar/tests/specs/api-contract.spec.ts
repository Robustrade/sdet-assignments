import { describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../framework/builders/subscription-request-builder';
import { WebhookEventBuilder } from '../framework/builders/webhook-event-builder';
import { ProviderAssertions } from '../framework/assertions/provider-assertions';
import { SubscriptionAssertions } from '../framework/assertions/subscription-assertions';
import { useBillingSystem } from '../framework/harness/suite';

/**
 * LEVEL 1 — API contract and validation.
 *
 * Related cases are asserted table-style inside one test rather than as one test
 * per row: a reviewer reads the table as the contract, and a failure names the
 * offending row.
 */
describe('Subscription API contract', () => {
  const suite = useBillingSystem();

  it('creates a trialing subscription for a plan with a trial, and does not charge yet', async () => {
    const response = await suite.env.api.create(
      SubscriptionRequestBuilder.aRequest().onPlan('pro').build()
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.stringMatching(/^sub_\d{3}$/),
      customer_id: 'cust_001',
      plan: 'pro',
      state: 'trialing',
      payment_method_id: 'pm_test_visa_4242',
      canceled_at: null,
      current_period_end: null
    });
    expect(response.body.trial_ends_at, 'pro has a 14 day trial').toBe('2026-01-15T00:00:00.000Z');

    ProviderAssertions.on(suite.env.provider).wasNeverCalled();
    await SubscriptionAssertions.for(suite.env, response.body.id).hasState('trialing');
    SubscriptionAssertions.for(suite.env, response.body.id).hasNoInvoices();
  });

  it('charges immediately and activates a plan configured without a trial', async () => {
    suite.env.provider.succeedsOnce();

    const response = await suite.env.api.create(
      SubscriptionRequestBuilder.aRequest().onPlan('scale').build()
    );

    expect(response.status).toBe(201);
    expect(response.body.state).toBe('active');
    expect(response.body.trial_ends_at).toBeNull();
    expect(response.body.current_period_end).not.toBeNull();

    ProviderAssertions.on(suite.env.provider)
      .wasCalledTimes(1)
      .lastChargeMatched({ amountCents: 9900, currency: 'USD', customerId: 'cust_001' });
    SubscriptionAssertions.for(suite.env, response.body.id).hasPaidInvoiceCount(1);
  });

  it('rejects invalid creation requests without persisting anything or calling the provider', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['unknown plan', SubscriptionRequestBuilder.aRequest().onPlan('platinum').build(), 'INVALID_PLAN'],
      ['missing customer_id', SubscriptionRequestBuilder.aRequest().without('customer_id').build(), 'MISSING_FIELD'],
      ['missing plan', SubscriptionRequestBuilder.aRequest().without('plan').build(), 'MISSING_FIELD'],
      ['missing payment_method_id', SubscriptionRequestBuilder.aRequest().without('payment_method_id').build(), 'MISSING_FIELD'],
      ['non-string plan', SubscriptionRequestBuilder.aRequest().with('plan', 42).build(), 'MISSING_FIELD'],
      ['unknown customer', SubscriptionRequestBuilder.aRequest().forCustomer('cust_ghost').build(), 'UNKNOWN_CUSTOMER'],
      ['payment method not on customer', SubscriptionRequestBuilder.aRequest().withPaymentMethod('pm_stolen').build(), 'UNKNOWN_PAYMENT_METHOD']
    ];

    for (const [label, payload, code] of cases) {
      const response = await suite.env.api.create(payload);
      expect(response.status, label).toBe(400);
      expect(response.body.error.code, label).toBe(code);
    }

    // A 400 that still wrote a row or charged a card would pass a status-only test.
    expect(suite.env.repos.subscriptions.all()).toHaveLength(0);
    expect(suite.env.repos.invoices.all()).toHaveLength(0);
    ProviderAssertions.on(suite.env.provider).wasNeverCalled();
  });

  it('retrieves a subscription, and 404s for one that does not exist', async () => {
    const created = await suite.env.scenarios.trialing();

    const found = await suite.env.api.get(created.id);
    const missing = await suite.env.api.get('sub_does_not_exist');

    expect(found.status).toBe(200);
    expect(found.body).toEqual(created);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('cancels a subscription once, then rejects a second cancellation as an illegal transition', async () => {
    const sub = await suite.env.scenarios.trialing();

    const first = await suite.env.api.cancel(sub.id);
    const second = await suite.env.api.cancel(sub.id);

    expect(first.status).toBe(200);
    expect(first.body.state).toBe('canceled');
    expect(first.body.canceled_at).not.toBeNull();

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ILLEGAL_TRANSITION');
    expect(second.body.error.details).toMatchObject({ from: 'canceled', trigger: 'cancel_requested' });

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('canceled');
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail('TRIAL_CANCELED_BY_API')
      .hasNotificationCount('subscription_canceled', 1);
    ProviderAssertions.on(suite.env.provider).wasNeverCalled();
  });

  it('accepts a correctly signed webhook', async () => {
    const sub = await suite.env.scenarios.awaitingProviderResult();
    const invoice = await suite.env.latestInvoice(sub.id);

    const response = await suite.env.webhooks.deliver(
      WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build()
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('processed');
    expect(response.body.subscription_state).toBe('active');
  });

  it('rejects unverified webhooks with 401 and records no event', async () => {
    const sub = await suite.env.scenarios.awaitingProviderResult();
    const invoice = await suite.env.latestInvoice(sub.id);
    const payload = WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build();

    // 'tampered' is a genuine signature — for different bytes than the ones sent.
    for (const signature of ['invalid', 'missing', 'tampered'] as const) {
      const response = await suite.env.webhooks.deliver(payload, { signature });
      expect(response.status, signature).toBe(401);
      expect(response.body.error.code, signature).toBe('INVALID_SIGNATURE');
    }

    expect(suite.env.repos.webhookEvents.all()).toHaveLength(0);
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('trialing');
  });

  it('rejects malformed and schema-invalid webhook payloads with 400', async () => {
    const malformed = await suite.env.webhooks.deliver(null, { rawBody: '{"event_id": ' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('MALFORMED_PAYLOAD');

    const cases: Array<[string, unknown]> = [
      ['missing event_id', WebhookEventBuilder.anEvent().without('event_id').build()],
      ['missing type', WebhookEventBuilder.anEvent().without('type').build()],
      ['unsupported type', WebhookEventBuilder.anEvent().with('type', 'payment.exploded').build()],
      ['non-integer amount', WebhookEventBuilder.anEvent().with('amount', '4900').build()],
      ['array body', []]
    ];
    for (const [label, payload] of cases) {
      const response = await suite.env.webhooks.deliver(payload);
      expect(response.status, label).toBe(400);
      expect(response.body.error.code, label).toBe('INVALID_PAYLOAD');
    }

    expect(suite.env.repos.webhookEvents.all()).toHaveLength(0);
  });

  it('404s on webhooks referencing an unknown subscription or invoice, without recording them', async () => {
    const sub = await suite.env.scenarios.trialing();

    const unknownSub = await suite.env.webhooks.deliver(
      WebhookEventBuilder.anEvent().forSubscription('sub_ghost').build()
    );
    const unknownInvoice = await suite.env.webhooks.deliver(
      WebhookEventBuilder.anEvent().forSubscription(sub).with('invoice_id', 'inv_ghost').build()
    );

    expect(unknownSub.status).toBe(404);
    expect(unknownSub.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');
    expect(unknownInvoice.status).toBe(404);
    expect(unknownInvoice.body.error.code).toBe('INVOICE_NOT_FOUND');
    // Not recorded: otherwise a genuinely mis-routed event would be swallowed as
    // a "duplicate" when the provider retries it.
    expect(suite.env.repos.webhookEvents.all()).toHaveLength(0);
  });
});
