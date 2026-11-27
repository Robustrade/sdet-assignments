import { useHarness } from '../framework/useHarness';

/**
 * The database itself refuses the duplicates and contradictions that idempotency depends on.
 * These go *around* the service on purpose: if a future code path forgets a check, the schema
 * still stops the bad write.
 */
describe('Schema constraints (enforced by the database, not by service code)', () => {
  const env = useHarness();

  it('webhook_events: the same event_id cannot be stored twice', async () => {
    const { invoiceId } = await env().given.signupChargeOutcomeUnknown();
    const event = env().webhooks.about(invoiceId).paymentSucceeded().build();
    await env().webhooks.send(event);
    const storedEvent = env().repos.webhookEvents.findById(event.event_id)!;

    const storeAgain = () => env().repos.webhookEvents.insert({ ...storedEvent });

    expect(storeAgain).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it('charge_attempts: an idempotency key cannot be reused, and an invoice cannot have two attempt #1s', async () => {
    const { invoiceId } = await env().given.active();
    const [existing] = env().repos.attempts.findByInvoice(invoiceId);

    const reuseIdempotencyKey = () => env().repos.attempts.insert({ ...existing!, id: 'att_dup', attemptNo: 2, providerChargeId: null });
    const reuseAttemptNumber = () => env().repos.attempts.insert({ ...existing!, id: 'att_dup2', idempotencyKey: 'other-key', providerChargeId: null });

    expect(reuseIdempotencyKey).toThrow(/UNIQUE constraint failed: charge_attempts.idempotency_key/);
    expect(reuseAttemptNumber).toThrow(/UNIQUE constraint failed: charge_attempts.invoice_id, charge_attempts.attempt_no/);
  });

  it('invoices: a billing period cannot be invoiced twice', async () => {
    const { subscriptionId, invoiceId } = await env().given.active();
    const invoice = env().repos.invoices.findById(invoiceId)!;

    const invoiceSamePeriodAgain = () => env().repos.invoices.insert({ ...invoice, id: 'inv_dup', subscriptionId });

    expect(invoiceSamePeriodAgain).toThrow(/UNIQUE constraint failed: invoices.subscription_id, invoices.period_start/);
  });

  it.each([
    ['status outside the lifecycle', "UPDATE subscriptions SET status = 'paused'"],
    ['canceled without canceled_at', "UPDATE subscriptions SET status = 'canceled'"],
  ])('subscriptions reject %s', async (_name, sql) => {
    await env().given.active();
    expect(() => env().db.run(sql)).toThrow(/CHECK constraint failed/);
  });

  it.each([
    ['paid without paid_at', "UPDATE invoices SET paid_at = NULL"],
  ])('invoices reject %s', async (_name, sql) => {
    await env().given.active();
    expect(() => env().db.run(sql)).toThrow(/CHECK constraint failed/);
  });

  it('a failed statement inside a transaction leaves nothing behind (atomicity)', async () => {
    const { subscriptionId } = await env().given.active();
    const dbBefore = env().snapshot();

    expect(() =>
      env().db.transaction(() => {
        env().repos.audit.append({ subscriptionId, action: 'probe', source: 'api', at: env().clock.now() });
        env().db.run("UPDATE subscriptions SET status = 'paused'");
      }),
    ).toThrow();

    expect(env().tablesChangedSince(dbBefore)).toEqual([]);
  });
});
