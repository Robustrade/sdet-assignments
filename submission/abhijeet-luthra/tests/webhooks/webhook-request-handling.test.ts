import { aWebhook } from '../support/builders/webhook-builder';
import { expectApiMatchesDb, expectNoDatabaseChanges } from '../support/assertions/expectations';
import { givenActiveSubscription, givenTimedOutFirstCharge } from '../support/fixtures/given';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/**
 * WH-01..07: request-level handling (authentication + payload validation),
 * tested separately from webhook business logic. Every rejection must leave
 * the database byte-for-byte unchanged.
 */
describe('POST /webhooks/payment-provider - request handling', () => {
  const env = useTestEnvironment();

  async function pendingInvoice() {
    const sub = await givenTimedOutFirstCharge(env); // invoice open, one unresolved attempt
    return env.latestInvoiceOf(sub.id);
  }

  test('WH-01 correctly signed payment.succeeded is processed and applied', async () => {
    const invoice = await pendingInvoice();
    const res = await env.webhooks.deliver(aWebhook().succeeded().forInvoice(invoice).build());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
    const sub = await expectApiMatchesDb(env, invoice.subscriptionId);
    expect(sub.status).toBe('active');
  });

  describe.each([
    ['WH-02 signature made with the wrong secret', 'wrong-secret'],
    ['WH-03 missing signature header', 'missing'],
    ['WH-04 body modified after signing', 'tampered-body'],
  ] as const)('%s', (_name, mode) => {
    test('-> 401 INVALID_SIGNATURE and no database change', async () => {
      const invoice = await pendingInvoice();
      const before = env.repos.snapshots.snapshot();

      const res = await env.webhooks.deliver(aWebhook().succeeded().forInvoice(invoice).build(), mode);

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('INVALID_SIGNATURE');
      expectNoDatabaseChanges(env, before);
    });
  });

  test('WH-05 malformed JSON (validly signed) -> 400 INVALID_EVENT, no change', async () => {
    await pendingInvoice();
    const before = env.repos.snapshots.snapshot();
    const res = await env.webhooks.deliverRaw('{"event_id": "evt_x", "type": ');

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_EVENT');
    expectNoDatabaseChanges(env, before);
  });

  test.each([
    ['unsupported type', (b: ReturnType<typeof aWebhook>) => b.with('type', 'payment.disputed'), 'type'],
    ['missing event_id', (b: ReturnType<typeof aWebhook>) => b.without('event_id'), 'event_id'],
    ['negative amount', (b: ReturnType<typeof aWebhook>) => b.with('amount', -5), 'amount'],
    ['fractional amount', (b: ReturnType<typeof aWebhook>) => b.with('amount', 19.5), 'amount'],
  ])('WH-06 %s -> 400 INVALID_EVENT naming the field, no change', async (_name, mutate, field) => {
    const invoice = await pendingInvoice();
    const before = env.repos.snapshots.snapshot();

    const res = await env.webhooks.deliver(mutate(aWebhook().succeeded().forInvoice(invoice)).build());

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_EVENT');
    expect(res.body.error?.details?.map((d) => d.field)).toContain(field);
    expectNoDatabaseChanges(env, before);
  });

  describe('WH-07 references that do not match stored records', () => {
    test('unknown subscription -> 404', async () => {
      const invoice = await pendingInvoice();
      const before = env.repos.snapshots.snapshot();
      const res = await env.webhooks.deliver(aWebhook().forInvoice(invoice).with('subscription_id', 'sub_missing').build());
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('SUBSCRIPTION_NOT_FOUND');
      expectNoDatabaseChanges(env, before);
    });

    test('unknown invoice -> 404', async () => {
      const invoice = await pendingInvoice();
      const before = env.repos.snapshots.snapshot();
      const res = await env.webhooks.deliver(aWebhook().forInvoice(invoice).with('invoice_id', 'inv_missing').build());
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('INVOICE_NOT_FOUND');
      expectNoDatabaseChanges(env, before);
    });

    test('invoice of a different subscription -> 422', async () => {
      const invoice = await pendingInvoice();
      const other = await givenActiveSubscription(env);
      const before = env.repos.snapshots.snapshot();
      const res = await env.webhooks.deliver(aWebhook().forInvoice(invoice).with('subscription_id', other.id).build());
      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe('EVENT_REFERENCE_MISMATCH');
      expectNoDatabaseChanges(env, before);
    });

    test('amount or currency mismatch -> 422', async () => {
      const invoice = await pendingInvoice();
      const before = env.repos.snapshots.snapshot();
      const wrongAmount = await env.webhooks.deliver(aWebhook().forInvoice(invoice).with('amount', 1).build());
      const wrongCurrency = await env.webhooks.deliver(aWebhook().forInvoice(invoice).with('currency', 'EUR').build());
      expect([wrongAmount.status, wrongCurrency.status]).toEqual([422, 422]);
      expectNoDatabaseChanges(env, before);
    });
  });

  test('the assignment example payload shape (no provider_reference) is accepted', async () => {
    const invoice = await pendingInvoice();
    const payload = aWebhook().succeeded().forInvoice(invoice).build();
    expect(Object.keys(payload).sort()).toEqual(['amount', 'currency', 'event_id', 'invoice_id', 'subscription_id', 'type']);
    expect((await env.webhooks.deliver(payload)).status).toBe(200);
  });
});
