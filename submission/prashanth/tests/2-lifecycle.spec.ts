import { test, expect } from './fixtures';
import { aWebhook } from './helpers/builders';
import { ALLOWED_MOVES, nextStatus, Status, LifecycleEvent } from '../src/stateMachine';

test.describe('State machine table', () => {
  test('matches the assignment diagram exactly (written out by hand here)', () => {
    // Independent answer key: if someone edits the table wrongly, this fails.
    const diagram: [Status, LifecycleEvent, Status][] = [
      ['trialing', 'PAYMENT_SUCCEEDED', 'active'],
      ['trialing', 'PAYMENT_FAILED', 'past_due'],
      ['active', 'PAYMENT_FAILED', 'past_due'],
      ['past_due', 'PAYMENT_SUCCEEDED', 'active'],
      ['past_due', 'RETRIES_EXHAUSTED', 'canceled'],
      ['active', 'CANCEL', 'canceled'],
      ['trialing', 'CANCEL', 'canceled'],
      ['active', 'PAYMENT_SUCCEEDED', 'active'], // renewal (stays active)
      ['past_due', 'PAYMENT_FAILED', 'past_due'], // retry failed, retries left
    ];
    for (const [from, event, to] of diagram) expect(nextStatus(from, event)).toBe(to);

    const allowedCount = Object.values(ALLOWED_MOVES).reduce((n, moves) => n + Object.keys(moves).length, 0);
    expect(allowedCount).toBe(diagram.length); // nothing extra is allowed
  });

  test('canceled is final: every event is rejected', () => {
    for (const event of ['PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'RETRIES_EXHAUSTED', 'CANCEL'] as LifecycleEvent[]) {
      expect(() => nextStatus('canceled', event)).toThrow('Not allowed');
    }
  });
});

test.describe('Every valid transition, through the real system', () => {
  test('trialing -> active: trial ends, first charge succeeds', async ({ api, given }) => {
    const { sub } = await given.basicWithTrialEnded();
    const res = await api.charge(sub.id);
    expect(res.body.outcome).toBe('succeeded');
    expect(res.body.subscription.status).toBe('active');
  });

  test('trialing -> active: via payment.succeeded webhook (after provider timeout)', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    await webhook.send(aWebhook().paymentSucceeded().forInvoice(invoice).build());
    expect(db.getSubscription(sub.id)?.status).toBe('active');
  });

  test('trialing -> past_due: trial ends, first charge fails', async ({ api, given, paymentProvider }) => {
    const { sub } = await given.basicWithTrialEnded();
    paymentProvider.willDecline('insufficient_funds');
    const res = await api.charge(sub.id);
    expect(res.body.subscription.status).toBe('past_due');
    expect(res.body.invoice).toMatchObject({ status: 'failed', note: 'insufficient_funds' });
  });

  test('trialing -> past_due: via payment.failed webhook', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    await webhook.send(aWebhook().paymentFailed().forInvoice(invoice).build());
    expect(db.getSubscription(sub.id)?.status).toBe('past_due');
  });

  test('active -> past_due: monthly renewal fails', async ({ api, given, paymentProvider }) => {
    const { sub } = await given.activePro();
    paymentProvider.willDecline();
    expect((await api.charge(sub.id)).body.subscription.status).toBe('past_due');
  });

  test('past_due -> active: retry succeeds', async ({ api, given, paymentProvider, db }) => {
    const { sub } = await given.pastDue();
    paymentProvider.willSucceed();
    expect((await api.charge(sub.id)).body.subscription.status).toBe('active');
    expect(db.getSubscription(sub.id)?.failedPayments).toBe(0);
  });

  test('past_due -> canceled: 3 failed payments in a row', async ({ api, given, paymentProvider, db }) => {
    const { sub } = await given.pastDue(); // failure 1
    paymentProvider.alwaysDecline();
    expect((await api.charge(sub.id)).body.subscription.status).toBe('past_due'); // failure 2
    expect((await api.charge(sub.id)).body.subscription.status).toBe('canceled'); // failure 3
    expect(db.auditOf(sub.id).map((a) => a.event)).toContain('RETRIES_EXHAUSTED');
  });

  test('active -> canceled: customer cancels', async ({ api, given }) => {
    const { sub } = await given.activePro();
    expect((await api.cancel(sub.id)).body.status).toBe('canceled');
  });

  test('trialing -> canceled: customer cancels during trial', async ({ api, given }) => {
    const { sub } = await given.trialingBasic();
    expect((await api.cancel(sub.id)).body.status).toBe('canceled');
  });
});

test.describe('Invalid transitions are blocked', () => {
  test('canceled -> active: a late payment.succeeded webhook does NOT bring it back', async ({ api, webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    await api.cancel(sub.id);

    const res = await webhook.send(aWebhook().paymentSucceeded().forInvoice(invoice).build());

    expect(res.body).toEqual({ status: 'ignored', reason: 'subscription_canceled' });
    expect(db.getSubscription(sub.id)?.status).toBe('canceled');
  });

  test('past_due -> canceled by API is not in the diagram -> 409', async ({ api, given, db }) => {
    const { sub } = await given.pastDue();
    expect((await api.cancel(sub.id)).status).toBe(409);
    expect(db.getSubscription(sub.id)?.status).toBe('past_due');
  });

  test('a canceled subscription is never charged again', async ({ api, given, paymentProvider }) => {
    const { sub } = await given.canceled();
    const callsBefore = paymentProvider.calls.length;
    const res = await api.charge(sub.id);
    expect(res.status).toBe(409);
    expect(paymentProvider.calls).toHaveLength(callsBefore);
  });
});

test.describe('Plan rules', () => {
  test('basic cannot be charged even 1 ms before its 14-day trial ends', async ({ api, given, clock, paymentProvider }) => {
    const { sub } = await given.trialingBasic();
    clock.advanceDays(14);
    clock.advanceMs(-1);
    const res = await api.charge(sub.id);
    expect(res.body.error).toBe('trial_not_ended');
    expect(paymentProvider.calls).toHaveLength(0);
  });

  test('basic is charged 1900, pro is charged 4900', async ({ api, given, paymentProvider }) => {
    const { sub } = await given.basicWithTrialEnded();
    await api.charge(sub.id);
    await given.activePro();
    expect(paymentProvider.calls.map((c) => c.amount)).toEqual([1900, 4900]);
  });
});
