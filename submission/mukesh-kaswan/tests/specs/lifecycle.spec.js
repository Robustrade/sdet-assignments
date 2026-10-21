const { test, expect } = require('../helpers/fixtures');
const { aWebhook } = require('../helpers/builders');
const { STATES, EVENTS, nextState } = require('../../src/stateMachine');

test.describe('Lifecycle: every valid transition', () => {
  test('trialing -> active when the first charge succeeds', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();

    const result = await api.sendWebhookOk(aWebhook().paymentSucceeded(sub).build());

    expect(result).toEqual({ result: 'processed' });
    await verify.subscriptionIs(sub.id, 'active');
    verify.invoiceStatuses(sub.id, ['paid']);
    verify.auditTrail(sub.id, ['trialing', 'active']);
  });

  test('trialing -> past_due when the first charge fails', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();

    await api.sendWebhookOk(aWebhook().paymentFailed(sub).build());

    await verify.subscriptionIs(sub.id, 'past_due');
    verify.invoiceStatuses(sub.id, ['failed']);
    verify.auditTrail(sub.id, ['trialing', 'past_due']);
  });

  test('active -> past_due when a recurring charge fails', async ({ api, given, verify }) => {
    const sub = await given.activeSubscription();

    await api.sendWebhookOk(aWebhook().paymentFailed(sub).build());

    await verify.subscriptionIs(sub.id, 'past_due');
    verify.invoiceStatuses(sub.id, ['paid', 'failed']);
    verify.auditTrail(sub.id, ['trialing', 'active', 'past_due']);
  });

  test('past_due -> active when a retry succeeds', async ({ api, given, db, verify }) => {
    const sub = await given.pastDueSubscription();
    const [failedInvoice] = db.invoicesFor(sub.id);

    await api.sendWebhookOk(aWebhook().paymentSucceeded(sub).withInvoiceId(failedInvoice.id).build());

    await verify.subscriptionIs(sub.id, 'active');
    verify.invoiceStatuses(sub.id, ['paid']); // same invoice, now paid - not a second row
    verify.auditTrail(sub.id, ['trialing', 'past_due', 'active']);
  });

  test('past_due -> canceled when retries are exhausted', async ({ api, given, verify }) => {
    const sub = await given.pastDueSubscription();

    await api.sendWebhookOk(aWebhook().paymentFailed(sub, { finalAttempt: true }).build());

    const canceled = await verify.subscriptionIs(sub.id, 'canceled');
    expect(canceled.canceled_at).not.toBeNull();
    verify.auditTrail(sub.id, ['trialing', 'past_due', 'canceled']);
  });

  test('active -> canceled via API', async ({ api, given, verify }) => {
    const sub = await given.activeSubscription();

    const res = await api.cancelSubscription(sub.id);

    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'canceled', canceled_at: expect.any(String) });
    await verify.subscriptionIs(sub.id, 'canceled');
    verify.auditTrail(sub.id, ['trialing', 'active', 'canceled']);
  });

  test('trialing -> canceled via API', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();

    const res = await api.cancelSubscription(sub.id);

    expect(res.status()).toBe(200);
    await verify.subscriptionIs(sub.id, 'canceled');
    verify.auditTrail(sub.id, ['trialing', 'canceled']);
  });
});

test.describe('Lifecycle: invalid transitions are impossible', () => {
  test('canceled -> active: a stray payment.succeeded webhook does not reactivate', async ({ api, given, verify }) => {
    const sub = await given.canceledSubscription();
    const webhook = aWebhook().paymentSucceeded(sub).build();

    const result = await api.sendWebhookOk(webhook);

    expect(result).toEqual({ result: 'ignored_invalid_transition' });
    await verify.subscriptionIs(sub.id, 'canceled');
    verify.invoiceStatuses(sub.id, []); // no side effect stored
    verify.webhookRecorded(webhook.payload.event_id, { outcome: 'ignored_invalid_transition' });
    verify.auditTrail(sub.id, ['trialing', 'canceled']);
  });

  test('canceled -> past_due: a stray payment.failed webhook is ignored', async ({ api, given, verify }) => {
    const sub = await given.canceledSubscription();

    const result = await api.sendWebhookOk(aWebhook().paymentFailed(sub).build());

    expect(result).toEqual({ result: 'ignored_invalid_transition' });
    await verify.subscriptionIs(sub.id, 'canceled');
    verify.invoiceStatuses(sub.id, []);
  });

  test('past_due -> canceled via API is rejected (not in the lifecycle)', async ({ api, given, verify }) => {
    const sub = await given.pastDueSubscription();

    const res = await api.cancelSubscription(sub.id);

    expect(res.status()).toBe(409);
    await verify.subscriptionIs(sub.id, 'past_due');
  });

  test('transition table allows exactly the documented transitions', () => {
    // Oracle written from the lifecycle diagram in the assignment.
    // Self-loops are renewals/retries that do not change state.
    const expected = {
      'trialing:charge_succeeded': 'active',
      'trialing:charge_failed': 'past_due',
      'trialing:cancel': 'canceled',
      'active:charge_succeeded': 'active',
      'active:charge_failed': 'past_due',
      'active:cancel': 'canceled',
      'past_due:charge_succeeded': 'active',
      'past_due:charge_failed': 'past_due',
      'past_due:retries_exhausted': 'canceled',
    };

    for (const state of STATES) {
      for (const event of EVENTS) {
        expect(nextState(state, event), `${state} + ${event}`).toBe(expected[`${state}:${event}`] ?? null);
      }
    }
  });
});
