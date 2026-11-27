import { aSignupRequest } from '../framework/builders';
import { expectError } from '../framework/verify/expectations';
import { useHarness } from '../framework/useHarness';

/**
 * Concurrent requests against one service instance. Overlap is made deterministic with the gateway
 * double's `holdNextCall()`: a charge is frozen mid-flight while the test does the racing action.
 */
describe('Concurrent delivery and racing work', () => {
  const env = useHarness();

  it('the same webhook delivered 10 times in parallel is processed exactly once', async () => {
    const { subscriptionId, invoiceId } = await env().given.signupChargeOutcomeUnknown();
    const event = env().webhooks.about(invoiceId).paymentSucceeded().build();

    const responses = await Promise.all(Array.from({ length: 10 }, () => env().webhooks.send(event)));

    const outcomes = responses.map((response) => (response.ok ? response.body.outcome : response.status));
    expect(outcomes.filter((outcome) => outcome === 'processed')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(9);
    expect(env().stored(subscriptionId).statusHistory()).toEqual(['trialing', 'active']);
  });

  it('customer cancels while the signup charge is in flight: subscription stays canceled, captured money is flagged for refund', async () => {
    const inFlight = env().gateway.holdNextCall();
    const signup = env().api.create(aSignupRequest().onProPlan().build());
    await inFlight.reached; // the charge is now with the provider
    const [subscriptionBeingCharged] = env().repos.subscriptions.findAll();
    expect(env().repos.attempts.findAll()).toEqual([expect.objectContaining({ status: 'pending' })]);

    const cancel = await env().api.cancel(subscriptionBeingCharged!.id);
    inFlight.release();
    await signup;

    expect(cancel.status).toBe(200);
    const stored = env().stored(subscriptionBeingCharged!.id);
    expect(stored.status).toBe('canceled');
    expect(stored.statusHistory()).toEqual(['trialing', 'canceled']);
    expect(stored.latestInvoice?.status).toBe('void');
    expect(stored.attempts).toEqual([expect.objectContaining({ status: 'succeeded' })]);
    expect(stored.auditActions()).toContain('charge_requires_refund');
    expect(stored.notificationKinds()).toContain('refund_required');
  });

  it('same Idempotency-Key sent twice concurrently: one subscription, one charge, the other request is told to retry', async () => {
    const request = aSignupRequest().onProPlan().build();
    const inFlight = env().gateway.holdNextCall();

    const firstRequest = env().api.create(request, { idempotencyKey: 'double-click' });
    await inFlight.reached; // first request is mid-charge
    const secondResponse = await env().api.create(request, { idempotencyKey: 'double-click' });
    inFlight.release();
    const firstResponse = await firstRequest;

    expect(firstResponse.status).toBe(201);
    expectError(secondResponse, 409, 'request_in_progress');
    expect(env().repos.subscriptions.findAll()).toHaveLength(1);
    expect(env().gateway.calls).toHaveLength(1);
  });

  it('two billing runs overlapping on a RETRY: the in-flight attempt blocks a second charge for the same invoice', async () => {
    const { invoiceId } = await env().given.pastDue();
    env().clock.set(env().repos.invoices.findById(invoiceId)!.nextRetryAt!);
    const inFlight = env().gateway.holdNextCall();

    const firstRun = env().runBilling();
    await inFlight.reached; // retry #2 is with the provider
    const secondRun = await env().runBilling();
    inFlight.release();
    await firstRun;

    expect(secondRun.chargesSent).toBe(0);
    expect(env().gateway.callsForInvoice(invoiceId)).toHaveLength(2); // signup + one retry
    expect(env().repos.attempts.findByInvoice(invoiceId)).toHaveLength(2);
  });
});
