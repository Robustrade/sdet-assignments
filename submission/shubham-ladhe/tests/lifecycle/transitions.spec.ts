import { SubscriptionStatus, WebhookEventType } from '../../src/domain/types';
import { BILLING_PERIOD_DAYS, PLANS } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';
import { TableName } from '../framework/verify/DbSnapshot';

/**
 * Lifecycle through the real interfaces (HTTP + billing job + provider double).
 * Each transition is checked in the stored row, in the audit trail, and in the API response.
 */
describe('Lifecycle: the seven valid transitions', () => {
  const env = useHarness();

  async function expectTransition(subscriptionId: string, from: SubscriptionStatus, to: SubscriptionStatus, source: string) {
    const stored = env().stored(subscriptionId);
    expect(stored.status).toBe(to);
    const lastStatusChange = stored.audit.filter((entry) => entry.action === 'status_changed').at(-1);
    expect(lastStatusChange).toMatchObject({ fromStatus: from, toStatus: to, source });
    expect((await env().api.getOk(subscriptionId)).status).toBe(to);
  }

  it('1. trialing -> active: trial ends and the first charge succeeds (billing job)', async () => {
    const { subscriptionId } = await env().given.trialing();
    env().gateway.willSucceed();

    await env().advanceDaysAndBill(PLANS.basic.trialDays);

    await expectTransition(subscriptionId, 'trialing', 'active', 'billing');
    expect(env().stored(subscriptionId).latestInvoice?.status).toBe('paid');
  });

  it('1b. trialing -> active driven by webhook (first charge outcome arrives asynchronously)', async () => {
    const { subscriptionId, invoiceId } = await env().given.signupChargeOutcomeUnknown();

    await env().webhooks.send(env().webhooks.about(invoiceId).paymentSucceeded());

    await expectTransition(subscriptionId, 'trialing', 'active', 'webhook');
  });

  it('2. trialing -> past_due: trial ends and the first charge fails (billing job)', async () => {
    const { subscriptionId } = await env().given.trialing();
    env().gateway.willDecline();

    await env().advanceDaysAndBill(PLANS.basic.trialDays);

    await expectTransition(subscriptionId, 'trialing', 'past_due', 'billing');
    expect(env().stored(subscriptionId).latestInvoice).toMatchObject({ status: 'open', failedAttempts: 1 });
  });

  it('3. active -> past_due: renewal charge fails', async () => {
    const { subscriptionId } = await env().given.active();
    env().gateway.willDecline();

    await env().advanceDaysAndBill(BILLING_PERIOD_DAYS);

    await expectTransition(subscriptionId, 'active', 'past_due', 'billing');
    expect(env().stored(subscriptionId).invoices.map((invoice) => invoice.status)).toEqual(['paid', 'open']);
  });

  it('4. past_due -> active: a retry succeeds', async () => {
    const { subscriptionId, invoiceId } = await env().given.pastDue();
    env().gateway.willSucceed();

    await env().billAtNextRetry(invoiceId);

    await expectTransition(subscriptionId, 'past_due', 'active', 'billing');
  });

  it('5. past_due -> canceled: retries exhausted', async () => {
    const { subscriptionId, invoiceId } = await env().given.pastDueOnLastRetry();
    env().gateway.willDecline();

    await env().billAtNextRetry(invoiceId);

    await expectTransition(subscriptionId, 'past_due', 'canceled', 'billing');
    expect(env().stored(subscriptionId).subscription.cancelReason).toBe('retries_exhausted');
    expect(env().repos.invoices.findById(invoiceId)?.status).toBe('uncollectible');
  });

  it('5b. past_due -> canceled driven by a final failure webhook', async () => {
    const { subscriptionId, invoiceId } = await env().given.pastDueOnLastRetry();

    await env().webhooks.send(env().webhooks.about(invoiceId).paymentFailed().withChargeId('ch_provider_final'));

    await expectTransition(subscriptionId, 'past_due', 'canceled', 'webhook');
  });

  it('6. active -> canceled: customer cancels', async () => {
    const { subscriptionId } = await env().given.active();

    await env().api.cancel(subscriptionId);

    await expectTransition(subscriptionId, 'active', 'canceled', 'api');
  });

  it('7. trialing -> canceled: customer cancels during the trial', async () => {
    const { subscriptionId } = await env().given.trialing();

    await env().api.cancel(subscriptionId);

    await expectTransition(subscriptionId, 'trialing', 'canceled', 'api');
  });
});

/**
 * Every external stimulus against every state, through HTTP. Expected results are written out
 * by hand (not derived from the service's table) so this is an independent check.
 */
describe('Lifecycle: stimulus x state matrix (HTTP)', () => {
  const env = useHarness();

  type Stimulus = 'cancel' | WebhookEventType;
  /** What the action is allowed to write: nothing, only the webhook log row, or real state changes. */
  type Writes = 'nothing' | 'webhook log only' | 'state';
  type Expected = { status: SubscriptionStatus; response: { http: number; outcome?: string; reason?: string }; writes: Writes };

  const ok = (outcome: string, reason?: string) => ({ http: 200, outcome, ...(reason ? { reason } : {}) });

  const matrix: Record<SubscriptionStatus, Record<Stimulus, Expected>> = {
    trialing: {
      cancel: { status: 'canceled', response: { http: 200 }, writes: 'state' },
      'payment.succeeded': { status: 'active', response: ok('processed'), writes: 'state' },
      'payment.failed': { status: 'past_due', response: ok('processed'), writes: 'state' },
      'payment.refunded': { status: 'trialing', response: ok('ignored', 'invoice_open'), writes: 'webhook log only' },
    },
    active: {
      cancel: { status: 'canceled', response: { http: 200 }, writes: 'state' },
      'payment.succeeded': { status: 'active', response: ok('ignored', 'invoice_paid'), writes: 'webhook log only' },
      'payment.failed': { status: 'active', response: ok('ignored', 'invoice_paid'), writes: 'webhook log only' },
      'payment.refunded': { status: 'active', response: ok('processed'), writes: 'state' },
    },
    past_due: {
      cancel: { status: 'past_due', response: { http: 409 }, writes: 'nothing' },
      'payment.succeeded': { status: 'active', response: ok('processed'), writes: 'state' },
      'payment.failed': { status: 'past_due', response: ok('processed'), writes: 'state' },
      'payment.refunded': { status: 'past_due', response: ok('ignored', 'invoice_open'), writes: 'webhook log only' },
    },
    canceled: {
      cancel: { status: 'canceled', response: { http: 409 }, writes: 'nothing' },
      'payment.succeeded': { status: 'canceled', response: ok('ignored', 'subscription_canceled'), writes: 'webhook log only' },
      'payment.failed': { status: 'canceled', response: ok('ignored', 'subscription_canceled'), writes: 'webhook log only' },
      'payment.refunded': { status: 'canceled', response: ok('ignored', 'invoice_uncollectible'), writes: 'webhook log only' },
    },
  };

  const rows = (Object.keys(matrix) as SubscriptionStatus[]).flatMap((state) =>
    (Object.keys(matrix[state]) as Stimulus[]).map((stimulus) => ({ state, stimulus, ...matrix[state][stimulus] })),
  );

  async function applyStimulus(stimulus: Stimulus, subscriptionId: string, invoiceId: string): Promise<Expected['response']> {
    if (stimulus === 'cancel') return { http: (await env().api.cancel(subscriptionId)).status };
    const response = await env().webhooks.send(env().webhooks.about(invoiceId).ofType(stimulus));
    if (!response.ok) return { http: response.status };
    const { outcome, reason } = response.body;
    return reason ? { http: response.status, outcome, reason } : { http: response.status, outcome };
  }

  function classifyWrites(changedTables: TableName[]): Writes {
    if (changedTables.length === 0) return 'nothing';
    if (changedTables.length === 1 && changedTables[0] === 'webhook_events') return 'webhook log only';
    return 'state';
  }

  it.each(rows)('$state + $stimulus -> $status ($response.http)', async ({ state, stimulus, status, response, writes }) => {
    const { subscriptionId, invoiceId } = await env().given.inState(state);
    const callsBefore = env().gateway.callCount();
    const dbBefore = env().snapshot();

    const actualResponse = await applyStimulus(stimulus, subscriptionId, invoiceId);

    expect(actualResponse).toMatchObject(response);
    expect(env().stored(subscriptionId).status).toBe(status);
    expect((await env().api.getOk(subscriptionId)).status).toBe(status);
    expect(classifyWrites(env().tablesChangedSince(dbBefore))).toBe(writes);
    expect(env().gateway.callsSince(callsBefore)).toEqual([]); // webhooks and cancels never charge
  });
});
