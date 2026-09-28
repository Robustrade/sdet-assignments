import { TestEnvironment } from '../../support/TestEnvironment';
import { InvariantChecker } from '../../support/InvariantChecker';
import { paymentRefunded, paymentSucceeded } from '../../support/builders/WebhookEventBuilder';

describe('Persistence & auditability', () => {
  let env: TestEnvironment;
  beforeEach(() => { env = TestEnvironment.create(); });
  afterEach(() => env.assertCleanTeardown());

  it('every lifecycle stage: DB rows match API and business rules (not just at creation)', async () => {
    // stage 1: trialing
    const sub = await env.given.trialingSubscription();
    await env.verify.expectSubscriptionIn(sub.id, 'trialing');
    expect(env.verify.snapshot(sub.id)).toMatchObject({ invoices: [], payments: [] });
    env.invariants.assertHolds();

    // stage 2: past_due after declined first charge
    env.clock.advanceDays(14);
    env.provider.willDecline();
    await env.runBilling(sub.id);
    await env.verify.expectSubscriptionIn(sub.id, 'past_due');
    expect(env.repos.subscriptions.getById(sub.id)).toMatchObject({ failedAttempts: 1, currentPeriodEnd: null });
    env.invariants.assertHolds();

    // stage 3: active after retry
    env.clock.advanceDays(1);
    env.provider.willSucceed();
    await env.runBilling(sub.id);
    await env.verify.expectSubscriptionIn(sub.id, 'active');
    const row = env.repos.subscriptions.getById(sub.id);
    expect(row).toMatchObject({ failedAttempts: 0, currentPeriodEnd: '2026-02-15T00:00:00.000Z' });
    const [inv] = env.repos.invoices.findBySubscription(sub.id);
    expect(inv).toMatchObject({ status: 'paid', amount: 1900, attemptCount: 2, paidAt: '2026-01-16T00:00:00.000Z' });
    expect(env.repos.payments.findByInvoice(inv.id).map((p) => [p.attempt, p.status])).toEqual([[1, 'failed'], [2, 'succeeded']]);
    env.invariants.assertHolds();

    // stage 4: canceled
    env.clock.advanceDays(3);
    await env.api.cancelSubscription(sub.id);
    await env.verify.expectSubscriptionIn(sub.id, 'canceled');
    expect(env.repos.subscriptions.getById(sub.id).canceledAt).toBe('2026-01-19T00:00:00.000Z');

    // audit trail tells the whole story, in order
    expect(env.repos.audit.forSubscription(sub.id).map((a) => a.action)).toEqual([
      'subscription.created',
      'transition.PAYMENT_FAILED',
      'transition.PAYMENT_SUCCEEDED',
      'transition.CANCEL',
    ]);
  });

  it('version increases monotonically with every write (optimistic concurrency column)', async () => {
    const sub = await env.given.pastDueSubscription();
    const v1 = env.repos.subscriptions.getById(sub.id).version;
    env.provider.willSucceed();
    await env.runBilling(sub.id);
    expect(env.repos.subscriptions.getById(sub.id).version).toBeGreaterThan(v1);
  });

  it('refund: invoice refunded, refund row written, subscription state unchanged', async () => {
    const sub = await env.given.activeSubscription('pro');
    const res = await env.webhooks.deliver(paymentRefunded().forLatestInvoiceOf(sub).build());

    expect(res.body.status).toBe('processed');
    expect(env.repos.invoices.findById(sub.latest_invoice!.id)!.status).toBe('refunded');
    expect(env.repos.payments.findBySubscription(sub.id).map((p) => p.status)).toEqual(['succeeded', 'refunded']);
    await env.verify.expectSubscriptionIn(sub.id, 'active');
  });

  it('refund for an unpaid invoice is ignored and not persisted', async () => {
    const sub = await env.given.trialWithPendingCharge();
    const res = await env.webhooks.deliver(paymentRefunded().forLatestInvoiceOf(sub).build());
    expect(res.body).toMatchObject({ status: 'ignored', reason: 'invoice_not_paid' });
    expect(env.repos.payments.findBySubscription(sub.id).map((p) => p.status)).toEqual(['pending']);
  });

  it('webhook ledger records processed, ignored and duplicate deliveries', async () => {
    const sub = await env.given.trialWithPendingCharge();
    const ok = paymentSucceeded().forLatestInvoiceOf(sub).build();
    const bad = paymentSucceeded().forLatestInvoiceOf(sub).withAmount(1).build();
    await env.webhooks.deliverTimes(ok, 2);
    await env.webhooks.deliver(bad);

    expect(env.repos.webhookEvents.all()).toEqual([
      expect.objectContaining({ eventId: ok.event_id, outcome: 'processed', deliveryCount: 2 }),
      expect.objectContaining({ eventId: bad.event_id, outcome: 'ignored', reason: 'amount_mismatch', deliveryCount: 1 }),
    ]);
  });

  it('each test starts from an empty, isolated database (no stale data)', () => {
    expect(env.repos.subscriptions.all()).toHaveLength(0);
    expect(env.repos.webhookEvents.all()).toHaveLength(0);
    expect(env.repos.audit.all()).toHaveLength(0);
  });

  it('repositories return copies: mutating a read result cannot change stored state', async () => {
    const sub = await env.given.trialingSubscription();
    const row = env.repos.subscriptions.getById(sub.id);
    (row as { status: string }).status = 'active';
    expect(env.repos.subscriptions.getById(sub.id).status).toBe('trialing');
  });

  describe('the InvariantChecker itself catches corruption (testing the tester)', () => {
    it('flags an active subscription whose only invoice failed', async () => {
      const sub = await env.given.pastDueSubscription();
      const fresh = TestEnvironment.create();
      // copy real rows into a scratch DB, then corrupt the status bypassing the state machine
      const db = fresh.container.db;
      const s = env.repos.subscriptions.getById(sub.id);
      db.subscriptions.set(s.id, { ...s, status: 'active' });
      env.repos.invoices.findBySubscription(sub.id).forEach((i) => db.invoices.set(i.id, i));
      env.repos.payments.findBySubscription(sub.id).forEach((p) => db.payments.set(p.id, p));

      const violations = new InvariantChecker(fresh.repos, fresh.container.catalog).violations();
      expect(violations).toEqual(expect.arrayContaining([
        expect.stringMatching(/^I1 .* active without any succeeded payment/),
        expect.stringMatching(/^I6 .* audit ends at trialing but row says active/),
      ]));
    });

    it('flags a double-paid invoice', async () => {
      const sub = await env.given.activeSubscription('pro');
      const fresh = TestEnvironment.create();
      const db = fresh.container.db;
      db.subscriptions.set(sub.id, env.repos.subscriptions.getById(sub.id));
      env.repos.invoices.findBySubscription(sub.id).forEach((i) => db.invoices.set(i.id, i));
      const [p] = env.repos.payments.findBySubscription(sub.id);
      db.payments.set(p.id, p);
      db.payments.set('pay_dupe', { ...p, id: 'pay_dupe' });

      expect(new InvariantChecker(fresh.repos, fresh.container.catalog).violations()).toEqual(
        expect.arrayContaining([expect.stringMatching(/^I2 .* 2 succeeded payments/)]),
      );
    });
  });
});
