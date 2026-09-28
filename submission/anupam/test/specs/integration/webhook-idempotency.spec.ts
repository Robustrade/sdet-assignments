import { TestEnvironment } from '../../support/TestEnvironment';
import { paymentFailed, paymentSucceeded } from '../../support/builders/WebhookEventBuilder';

describe('Webhook idempotency & duplicate delivery', () => {
  let env: TestEnvironment;
  beforeEach(() => { env = TestEnvironment.create(); });
  afterEach(() => env.assertCleanTeardown());

  it('same event_id delivered twice: transition happens exactly once', async () => {
    const sub = await env.given.trialWithPendingCharge();
    const event = paymentSucceeded().forLatestInvoiceOf(sub).build();

    const [first, second] = await env.webhooks.deliverTimes(event, 2);

    expect(first.body.status).toBe('processed');
    expect(second.status).toBe(200); // ack so the provider stops redelivering
    expect(second.body.status).toBe('duplicate');
    expect(env.verify.transitionsOf(sub.id)).toEqual(['trialing->active']);
  });

  it('redelivery x5 creates no duplicate payment/invoice rows and ledger counts deliveries', async () => {
    const sub = await env.given.trialWithPendingCharge();
    const event = paymentSucceeded().forLatestInvoiceOf(sub).build();

    await env.webhooks.deliverTimes(event, 5);

    const snap = env.verify.snapshot(sub.id);
    expect(snap.invoices).toHaveLength(1);
    expect(snap.payments).toEqual([expect.objectContaining({ status: 'succeeded' })]);
    expect(snap.webhookEvents).toEqual([
      expect.objectContaining({ eventId: event.event_id, outcome: 'processed', deliveryCount: 5 }),
    ]);
    expect(snap.audit.filter((a) => a.action === 'webhook.duplicate_ignored')).toHaveLength(4);
  });

  it('duplicate does not fire the notification side effect twice', async () => {
    const sub = await env.given.trialWithPendingCharge();
    await env.webhooks.deliverTimes(paymentSucceeded().forLatestInvoiceOf(sub).build(), 3);
    expect(env.notifier.for(sub.id)).toEqual([{ subscriptionId: sub.id, kind: 'subscription.active' }]);
  });

  it('duplicate payment.failed does not double-count dunning attempts', async () => {
    const sub = await env.given.activeWithPendingRenewal();
    await env.webhooks.deliverTimes(paymentFailed().forLatestInvoiceOf(sub).build(), 3);
    expect(env.repos.subscriptions.getById(sub.id).failedAttempts).toBe(1);
    await env.verify.expectSubscriptionIn(sub.id, 'past_due');
  });

  it('replayed webhooks never call the payment provider', async () => {
    const sub = await env.given.trialWithPendingCharge();
    const callsBefore = env.provider.callCount;
    await env.webhooks.deliverTimes(paymentSucceeded().forLatestInvoiceOf(sub).build(), 3);
    expect(env.provider.callCount).toBe(callsBefore);
  });

  it('DIFFERENT event_id for an invoice already paid synchronously is a no-op (cross-channel duplicate)', async () => {
    const sub = await env.given.activeSubscription('pro'); // paid via provider response
    const res = await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(sub).build());
    expect(res.body).toMatchObject({ status: 'ignored', reason: 'invoice_already_paid' });
    expect(env.repos.payments.findBySubscription(sub.id)).toHaveLength(1);
  });

  it('payment.failed webhook echoing a decline we already recorded is not counted twice', async () => {
    const sub = await env.given.pastDueSubscription(); // sync decline recorded
    const res = await env.webhooks.deliver(paymentFailed().forLatestInvoiceOf(sub).build());
    expect(res.body).toMatchObject({ status: 'ignored', reason: 'no_outstanding_attempt' });
    expect(env.repos.subscriptions.getById(sub.id).failedAttempts).toBe(1);
    expect(env.repos.payments.findBySubscription(sub.id)).toHaveLength(1);
  });

  it('an ignored event is still idempotent (second delivery = duplicate, not re-evaluated)', async () => {
    const event = paymentSucceeded().forSubscriptionId('sub_ghost').build();
    const [a, b] = await env.webhooks.deliverTimes(event, 2);
    expect(a.body.status).toBe('ignored');
    expect(b.body.status).toBe('duplicate');
  });
});
