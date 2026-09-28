import { TestEnvironment } from '../../support/TestEnvironment';
import { paymentSucceeded } from '../../support/builders/WebhookEventBuilder';

/**
 * Transport/security concerns of the webhook endpoint, kept separate from
 * webhook BUSINESS logic (see workflow/ and integration/ specs).
 */
describe('POST /webhooks/payment-provider - request handling', () => {
  let env: TestEnvironment;
  beforeEach(() => { env = TestEnvironment.create(); });
  afterEach(() => env.assertCleanTeardown());

  const expectNoEffects = (subId: string, before: ReturnType<TestEnvironment['verify']['snapshot']>) => {
    expect(env.verify.snapshot(subId)).toEqual(before);
    expect(env.repos.webhookEvents.all()).toHaveLength(0);
  };

  it('correctly signed event -> 200 processed', async () => {
    const sub = await env.given.trialWithPendingCharge();
    const res = await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(sub).build());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ event_id: expect.any(String), status: 'processed', reason: null });
  });

  describe('rejected with 401 and zero side effects', () => {
    let sub: Awaited<ReturnType<TestEnvironment['given']['trialWithPendingCharge']>>;
    let before: ReturnType<TestEnvironment['verify']['snapshot']>;
    beforeEach(async () => {
      sub = await env.given.trialWithPendingCharge();
      before = env.verify.snapshot(sub.id);
    });

    it('signature made with the wrong secret', async () => {
      const res = await env.webhooks.deliverWithForgedSignature(paymentSucceeded().forLatestInvoiceOf(sub).build());
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_signature');
      expectNoEffects(sub.id, before);
    });

    it('missing signature header', async () => {
      const res = await env.webhooks.deliverUnsigned(paymentSucceeded().forLatestInvoiceOf(sub).build());
      expect(res.status).toBe(401);
      expectNoEffects(sub.id, before);
    });

    it('body tampered after signing (amount changed)', async () => {
      const genuine = paymentSucceeded().forLatestInvoiceOf(sub).build();
      const res = await env.webhooks.deliverTampered(genuine, { ...genuine, amount: 1 });
      expect(res.status).toBe(401);
      expectNoEffects(sub.id, before);
    });
  });

  describe('signed but malformed -> 400 and nothing recorded', () => {
    it('invalid JSON', async () => {
      const res = await env.webhooks.deliverRawSigned('{"event_id": ');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('malformed_payload');
      expect(env.repos.webhookEvents.all()).toHaveLength(0);
    });

    it('JSON array instead of object', async () => {
      expect((await env.webhooks.deliverRawSigned('[1,2]')).status).toBe(400);
    });

    it.each([
      ['missing event_id', (b: ReturnType<typeof paymentSucceeded>) => b.without('event_id')],
      ['missing invoice_id', (b: ReturnType<typeof paymentSucceeded>) => b.without('invoice_id')],
      ['unknown type', (b: ReturnType<typeof paymentSucceeded>) => b.with('type', 'payment.teleported')],
      ['amount as string', (b: ReturnType<typeof paymentSucceeded>) => b.withAmount('4900')],
      ['negative amount', (b: ReturnType<typeof paymentSucceeded>) => b.withAmount(-5)],
      ['fractional amount', (b: ReturnType<typeof paymentSucceeded>) => b.withAmount(49.5)],
    ])('%s', async (_label, mutate) => {
      const res = await env.webhooks.deliver(mutate(paymentSucceeded()).build());
      expect(res.status).toBe(400);
      expect(env.repos.webhookEvents.all()).toHaveLength(0);
    });
  });

  describe('well-formed but not applicable -> 200 ignored (so provider stops retrying), recorded with reason', () => {
    it('unknown subscription', async () => {
      const event = paymentSucceeded().forSubscriptionId('sub_ghost').build();
      const res = await env.webhooks.deliver(event);
      expect(res.body).toMatchObject({ status: 'ignored', reason: 'unknown_subscription' });
      expect(env.repos.webhookEvents.findById(event.event_id as string)).toMatchObject({ outcome: 'ignored', reason: 'unknown_subscription' });
    });

    it('invoice belonging to another subscription', async () => {
      const a = await env.given.trialWithPendingCharge();
      const b = await env.given.trialWithPendingCharge();
      const res = await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(a).forSubscriptionId(b.id).build());
      expect(res.body).toMatchObject({ status: 'ignored', reason: 'unknown_invoice' });
      await env.verify.expectSubscriptionIn(b.id, 'trialing');
    });

    it('amount does not match the invoice', async () => {
      const sub = await env.given.trialWithPendingCharge();
      const res = await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(sub).withAmount(100).build());
      expect(res.body).toMatchObject({ status: 'ignored', reason: 'amount_mismatch' });
      await env.verify.expectSubscriptionIn(sub.id, 'trialing');
    });
  });
});
