const { test, expect } = require('../helpers/fixtures');
const { aWebhook } = require('../helpers/builders');

test.describe('Webhook request handling (signature & payload)', () => {
  test('accepts a correctly signed webhook', async ({ api, given }) => {
    const sub = await given.trialingSubscription();

    const res = await api.sendWebhook(aWebhook().paymentSucceeded(sub).build());

    expect(res.status()).toBe(200);
  });

  const rejectedSignatures = [
    { name: 'a forged signature', build: (sub) => aWebhook().paymentSucceeded(sub).withForgedSignature().build() },
    { name: 'a missing signature', build: (sub) => aWebhook().paymentSucceeded(sub).unsigned().build() },
    {
      name: 'a body tampered with after signing',
      build: (sub) => {
        const webhook = aWebhook().paymentSucceeded(sub).build();
        return { ...webhook, body: webhook.body.replace('"amount":1900', '"amount":1') };
      },
    },
  ];

  for (const { name, build } of rejectedSignatures) {
    test(`rejects ${name} with 401 and changes nothing`, async ({ api, given, db, verify }) => {
      const sub = await given.trialingSubscription();

      const res = await api.sendWebhook(build(sub));

      expect(res.status()).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'INVALID_SIGNATURE' });
      await verify.subscriptionIs(sub.id, 'trialing');
      verify.invoiceStatuses(sub.id, []);
      expect(db.webhookEventsFor(sub.id)).toHaveLength(0);
    });
  }

  test('rejects a signed but malformed JSON body with 400', async ({ api }) => {
    const res = await api.sendWebhook(aWebhook().withMalformedBody().build());

    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'MALFORMED_PAYLOAD' });
  });

  const invalidPayloads = [
    { name: 'missing event_id', mutate: (w) => w.without('event_id'), error: 'INVALID_WEBHOOK_PAYLOAD' },
    { name: 'missing invoice_id', mutate: (w) => w.without('invoice_id'), error: 'INVALID_WEBHOOK_PAYLOAD' },
    { name: 'unknown event type', mutate: (w) => w.ofType('payment.exploded'), error: 'UNKNOWN_EVENT_TYPE' },
    { name: 'negative amount', mutate: (w) => w.with('amount', -100), error: 'INVALID_WEBHOOK_PAYLOAD' },
  ];

  for (const { name, mutate, error } of invalidPayloads) {
    test(`rejects a payload with ${name} with 400`, async ({ api, given, db, verify }) => {
      const sub = await given.trialingSubscription();

      const res = await api.sendWebhook(mutate(aWebhook().paymentSucceeded(sub)).build());

      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({ error });
      await verify.subscriptionIs(sub.id, 'trialing');
      expect(db.webhookEventsFor(sub.id)).toHaveLength(0);
    });
  }

  test('returns 404 for a webhook about an unknown subscription', async ({ api }) => {
    const res = await api.sendWebhook(aWebhook().paymentSucceeded({ id: 'sub_nope', price: 1900, currency: 'USD' }).build());

    expect(res.status()).toBe(404);
  });
});

test.describe('Webhook idempotency (duplicate delivery)', () => {
  test('the same event_id delivered twice transitions exactly once', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();
    const webhook = aWebhook().paymentSucceeded(sub).build();

    const first = await api.sendWebhookOk(webhook);
    const second = await api.sendWebhookOk(webhook);

    expect(first).toEqual({ result: 'processed' });
    expect(second).toEqual({ result: 'duplicate' });
    await verify.subscriptionIs(sub.id, 'active');
    verify.invoiceStatuses(sub.id, ['paid']); // one invoice row, not two
    verify.auditTrail(sub.id, ['trialing', 'active']); // one transition, not two
    verify.webhookRecorded(webhook.payload.event_id, { outcome: 'processed', delivery_count: 2 });
    verify.providerNotCalled();
  });

  test('a redelivered old event does not undo a newer state', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();
    const succeeded = aWebhook().paymentSucceeded(sub).build();
    await api.sendWebhookOk(succeeded);
    await api.sendWebhookOk(aWebhook().paymentFailed(sub).build()); // renewal fails -> past_due

    const replay = await api.sendWebhookOk(succeeded);

    expect(replay).toEqual({ result: 'duplicate' });
    await verify.subscriptionIs(sub.id, 'past_due');
    verify.auditTrail(sub.id, ['trialing', 'active', 'past_due']);
  });

  test('bonus: the same event delivered concurrently is processed once', async ({ api, given, db, verify }) => {
    const sub = await given.trialingSubscription();
    const webhook = aWebhook().paymentSucceeded(sub).build();

    const results = await Promise.all([api.sendWebhookOk(webhook), api.sendWebhookOk(webhook), api.sendWebhookOk(webhook)]);

    expect(results.map((r) => r.result).sort()).toEqual(['duplicate', 'duplicate', 'processed']);
    verify.auditTrail(sub.id, ['trialing', 'active']);
    expect(db.findWebhookEvent(webhook.payload.event_id).delivery_count).toBe(3);
  });
});

test.describe('Webhook ordering & refunds', () => {
  test('payment.failed arriving after payment.succeeded for the same invoice does not regress', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();
    const invoiceId = 'inv_out_of_order';
    await api.sendWebhookOk(aWebhook().paymentSucceeded(sub).withInvoiceId(invoiceId).build());
    const lateFailure = aWebhook().paymentFailed(sub).withInvoiceId(invoiceId).build();

    const result = await api.sendWebhookOk(lateFailure);

    expect(result).toEqual({ result: 'ignored_stale' });
    await verify.subscriptionIs(sub.id, 'active');
    verify.invoiceStatuses(sub.id, ['paid']);
    verify.webhookRecorded(lateFailure.payload.event_id, { outcome: 'ignored_stale' });
  });

  test('payment.refunded marks the invoice refunded without changing the subscription state', async ({ api, given, db, verify }) => {
    const sub = await given.activeSubscription();
    const [paidInvoice] = db.invoicesFor(sub.id);

    await api.sendWebhookOk(aWebhook().paymentRefunded(sub).withInvoiceId(paidInvoice.id).build());

    await verify.subscriptionIs(sub.id, 'active');
    verify.invoiceStatuses(sub.id, ['refunded']);
  });

  test('payment.refunded for an invoice that was never paid is ignored', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();

    const result = await api.sendWebhookOk(aWebhook().paymentRefunded(sub).build());

    expect(result).toEqual({ result: 'ignored_no_paid_invoice' });
    verify.invoiceStatuses(sub.id, []);
  });

  test('a late payment.succeeded for an already-paid invoice does not reactivate a past_due subscription', async ({ api, given, verify }) => {
    const sub = await given.trialingSubscription();
    // First delivery of this success is delayed by the provider...
    const delayedSuccess = aWebhook().paymentSucceeded(sub).withInvoiceId('inv_month_1').build();
    await api.sendWebhookOk(aWebhook().paymentSucceeded(sub).withInvoiceId('inv_month_1').build());
    await api.sendWebhookOk(aWebhook().paymentFailed(sub).withInvoiceId('inv_month_2').build());

    // ...and arrives after the renewal for month 2 has already failed.
    const result = await api.sendWebhookOk(delayedSuccess);

    expect(result).toEqual({ result: 'ignored_stale' });
    await verify.subscriptionIs(sub.id, 'past_due');
    verify.auditTrail(sub.id, ['trialing', 'active', 'past_due']);
  });
});

test.describe('Webhook data integrity', () => {
  const mismatches = [
    { name: 'an amount lower than the plan price', mutate: (w) => w.with('amount', 1) },
    { name: 'a different currency', mutate: (w) => w.with('currency', 'EUR') },
  ];

  for (const { name, mutate } of mismatches) {
    test(`payment.succeeded with ${name} does not activate the subscription`, async ({ api, given, verify }) => {
      const sub = await given.trialingSubscription();

      const result = await api.sendWebhookOk(mutate(aWebhook().paymentSucceeded(sub)).build());

      expect(result).toEqual({ result: 'ignored_amount_mismatch' });
      await verify.subscriptionIs(sub.id, 'trialing');
      verify.invoiceStatuses(sub.id, []);
    });
  }

  test('a webhook cannot take over an invoice that belongs to another subscription', async ({ api, given, db, verify }) => {
    const owner = await given.activeSubscription();
    const [ownersInvoice] = db.invoicesFor(owner.id);
    const other = await given.trialingSubscription();

    const result = await api.sendWebhookOk(aWebhook().paymentFailed(other).withInvoiceId(ownersInvoice.id).build());

    expect(result).toEqual({ result: 'ignored_invoice_mismatch' });
    expect(db.findInvoice(ownersInvoice.id)).toEqual(ownersInvoice);
    await verify.subscriptionIs(owner.id, 'active');
    await verify.subscriptionIs(other.id, 'trialing');
  });
});
