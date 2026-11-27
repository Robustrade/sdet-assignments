import { useHarness } from '../framework/useHarness';

/**
 * Providers deliver at-least-once. Every assertion here is made on stored state, not just on the
 * second HTTP response: "200 OK" on a redelivery proves nothing about double-processing.
 */
describe('Duplicate webhook delivery', () => {
  const env = useHarness();

  it('same event_id twice: transition happens once, second delivery changes nothing at all', async () => {
    const { subscriptionId, invoiceId } = await env().given.signupChargeOutcomeUnknown();
    const event = env().webhooks.about(invoiceId).paymentSucceeded().build();

    const firstDelivery = await env().webhooks.send(event);
    const dbAfterFirstDelivery = env().snapshot();
    const redelivery = await env().webhooks.send(event);

    expect(firstDelivery.body).toMatchObject({ outcome: 'processed' });
    expect(redelivery).toMatchObject({ status: 200, body: { event_id: event.event_id, outcome: 'duplicate' } });
    expect(env().tablesChangedSince(dbAfterFirstDelivery)).toEqual([]);

    const stored = env().stored(subscriptionId);
    expect(stored.statusHistory()).toEqual(['trialing', 'active']);
    expect(stored.webhookEvents).toHaveLength(1);
    expect(stored.attempts.filter((attempt) => attempt.status === 'succeeded')).toHaveLength(1);
  });

  it('a redelivered failure is not counted twice against the retry budget', async () => {
    const { invoiceId } = await env().given.pastDue();
    const event = env().webhooks.about(invoiceId).paymentFailed().withChargeId('ch_provider_retry').build();

    await env().webhooks.send(event);
    await env().webhooks.send(event);
    await env().webhooks.send(event);

    expect(env().repos.invoices.findById(invoiceId)).toMatchObject({ failedAttempts: 2, status: 'open' });
    expect(env().repos.attempts.findByInvoice(invoiceId)).toHaveLength(2);
  });

  it('side effects (customer notifications) fire once per cause, however many times the event arrives', async () => {
    const { subscriptionId, invoiceId } = await env().given.signupChargeOutcomeUnknown();
    const event = env().webhooks.about(invoiceId).paymentSucceeded().build();

    for (let delivery = 1; delivery <= 5; delivery++) await env().webhooks.send(event);

    expect(env().stored(subscriptionId).notificationKinds()).toEqual(['payment_receipt']);
  });

  it('the provider re-sends the same charge result under a NEW event_id: recognised by charge id, not re-applied', async () => {
    const { subscriptionId, invoiceId } = await env().given.pastDue();
    const providerChargeId = 'ch_provider_retry_7';
    await env().webhooks.send(env().webhooks.about(invoiceId).paymentFailed().withChargeId(providerChargeId));
    const dbBefore = env().snapshot();

    const resent = await env().webhooks.send(env().webhooks.about(invoiceId).paymentFailed().withChargeId(providerChargeId));

    expect(resent.body).toMatchObject({ outcome: 'ignored', reason: 'attempt_already_settled' });
    expect(env().tablesChangedSince(dbBefore)).toEqual(['webhook_events']);
    expect(env().stored(subscriptionId).latestInvoice?.failedAttempts).toBe(2);
  });
});
