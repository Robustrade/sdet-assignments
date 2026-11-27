import { aSignupRequest } from '../framework/builders';
import { PLANS } from '../framework/fixtures';
import { FailingAuditLog } from '../framework/doubles/FaultInjection';
import { useHarness } from '../framework/useHarness';

describe('Provider timeouts: charge outcome unknown', () => {
  const env = useHarness();

  it('timed out but the provider DID take the money: re-send with the same key returns the original charge, customer charged once', async () => {
    env().gateway.willTimeout({ captured: true });
    const created = await env().api.createOk(aSignupRequest().onProPlan().build());
    expect(created.status).toBe('trialing');

    await env().runBilling(); // reconciliation re-send

    const [onlyCapture] = env().gateway.capturedCharges();
    expect(env().gateway.calls).toHaveLength(2);
    expect(env().gateway.capturedCharges()).toHaveLength(1);
    expect(env().stored(created.id).status).toBe('active');
    expect(env().stored(created.id).attempts).toEqual([
      expect.objectContaining({ status: 'succeeded', providerChargeId: onlyCapture!.providerChargeId }),
    ]);
  });

  it('repeated timeouts keep the attempt unknown and never spend the retry budget', async () => {
    env().gateway.willTimeout().willTimeout().willTimeout();
    const created = await env().api.createOk(aSignupRequest().onProPlan().build());

    await env().runBilling();
    await env().runBilling();

    const stored = env().stored(created.id);
    expect(stored.status).toBe('trialing');
    expect(stored.attempts).toEqual([expect.objectContaining({ status: 'unknown' })]);
    expect(stored.latestInvoice?.failedAttempts).toBe(0);
    expect(env().gateway.distinctIdempotencyKeys()).toHaveLength(1);
  });
});

describe('Partial failures: crash in the middle of a unit of work', () => {
  let failingAuditLog: FailingAuditLog;
  const env = useHarness({
    repositoryOverrides: (db) => {
      failingAuditLog = new FailingAuditLog(db);
      return { audit: failingAuditLog };
    },
  });

  it('webhook processing fails halfway: nothing is persisted, the event is not marked seen, redelivery succeeds once', async () => {
    const { subscriptionId, invoiceId } = await env().given.signupChargeOutcomeUnknown();
    const event = env().webhooks.about(invoiceId).paymentSucceeded().build();
    const dbBefore = env().snapshot();

    failingAuditLog.failNext('status_changed');
    const crashed = await env().webhooks.send(event);

    expect(crashed.status).toBe(500);
    expect(env().tablesChangedSince(dbBefore)).toEqual([]);
    expect(env().repos.webhookEvents.findById(event.event_id)).toBeUndefined();

    const redelivered = await env().webhooks.send(event);
    expect(redelivered.body).toMatchObject({ outcome: 'processed' });
    expect(env().stored(subscriptionId).statusHistory()).toEqual(['trialing', 'active']);
  });

  it('provider charged but recording the result failed: next billing run reconciles with the same key, no double charge', async () => {
    const { subscriptionId } = await env().given.trialing();
    failingAuditLog.failNext('payment_succeeded');
    env().clock.advanceDays(PLANS.basic.trialDays);

    const crashedRun = await env().runBilling();
    expect(crashedRun.recordingFailures).toBe(1);
    expect(env().stored(subscriptionId).status).toBe('trialing');
    expect(env().stored(subscriptionId).attempts).toEqual([expect.objectContaining({ status: 'unknown' })]);

    await env().runBilling();

    expect(env().gateway.capturedCharges()).toHaveLength(1);
    expect(env().gateway.distinctIdempotencyKeys()).toHaveLength(1);
    expect(env().stored(subscriptionId).status).toBe('active');
  });
});
