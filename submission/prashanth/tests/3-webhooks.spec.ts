import { test, expect } from './fixtures';
import { aWebhook } from './helpers/builders';

test.describe('Webhook security and input checks', () => {
  test('valid signed event is accepted', async ({ webhook, given }) => {
    const { invoice } = await given.proWithPaymentInProgress();
    const res = await webhook.send(aWebhook().paymentSucceeded().forInvoice(invoice).build());
    expect(res).toEqual({ status: 200, body: { status: 'applied', reason: null } });
  });

  test('missing, forged or tampered signature -> 401 and NOTHING changes', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    const event = aWebhook().paymentSucceeded().forInvoice(invoice).build();
    const tamperedSignature = webhook.sign(JSON.stringify({ ...event, amount: 1 }));

    expect((await webhook.sendWithoutSignature(event)).body.error).toBe('missing_signature');
    expect((await webhook.sendSignedWithWrongSecret(event)).body.error).toBe('invalid_signature');
    expect((await webhook.sendRaw(JSON.stringify(event), tamperedSignature)).body.error).toBe('invalid_signature');

    expect(db.getSubscription(sub.id)?.status).toBe('trialing');
    expect(db.getWebhookEvent(event.event_id as string)).toBeUndefined();
  });

  test('broken JSON or missing fields -> 400', async ({ webhook }) => {
    const raw = '{"event_id": "evt_x",';
    expect((await webhook.sendRaw(raw, webhook.sign(raw))).body.error).toBe('malformed_json');
    for (const field of ['event_id', 'type', 'subscription_id', 'invoice_id', 'amount', 'currency']) {
      const res = await webhook.send(aWebhook().without(field).build());
      expect(res.status, `missing ${field}`).toBe(400);
      expect(res.body.field).toBe(field);
    }
  });

  test('wrong amount for the invoice is ignored', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    const res = await webhook.send(aWebhook().paymentSucceeded().forInvoice(invoice).with('amount', 1).build());
    expect(res.body.reason).toBe('amount_mismatch');
    expect(db.getSubscription(sub.id)?.status).toBe('trialing');
  });
});

test.describe('Duplicate webhooks (idempotency)', () => {
  test('same event sent twice: status changes ONCE, one invoice, one email', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    const event = aWebhook().paymentSucceeded().forInvoice(invoice).build();

    const first = await webhook.send(event);
    const second = await webhook.send(event);

    expect(first.body.status).toBe('applied');
    expect(second).toEqual({ status: 200, body: { status: 'duplicate', reason: 'already_processed' } });
    expect(db.auditOf(sub.id).filter((a) => a.event === 'PAYMENT_SUCCEEDED')).toHaveLength(1);
    expect(db.invoicesOf(sub.id)).toHaveLength(1);
    expect(db.outboxOf(sub.id)).toEqual([{ subscriptionId: sub.id, message: 'status changed to active' }]);
    expect(db.getWebhookEvent(event.event_id as string)?.timesReceived).toBe(2);
  });

  test('duplicate payment.failed counts as ONE failure (no early cancellation)', async ({ api, webhook, given, paymentProvider, db }) => {
    const { sub } = await given.pastDue(); // failure 1
    paymentProvider.willTimeout();
    const retry = await api.charge(sub.id);
    const event = aWebhook().paymentFailed().forInvoice(retry.body.invoice).build();

    await webhook.send(event); // failure 2
    await webhook.send(event); // duplicate, must not become failure 3
    await webhook.send(event);

    expect(db.getSubscription(sub.id)?.failedPayments).toBe(2);
    expect(db.getSubscription(sub.id)?.status).toBe('past_due');
  });

  test('a different event for an already-paid invoice creates no second payment', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.activePro(); // invoice already paid by the direct charge
    const res = await webhook.send(aWebhook().paymentSucceeded().forInvoice(invoice).build());
    expect(res.body).toEqual({ status: 'ignored', reason: 'invoice_already_paid' });
    expect(db.invoicesOf(sub.id)).toHaveLength(1);
  });

  test('webhooks (new or repeated) never call the payment provider', async ({ webhook, given, paymentProvider }) => {
    const { invoice } = await given.proWithPaymentInProgress();
    const event = aWebhook().paymentSucceeded().forInvoice(invoice).build();
    await webhook.send(event);
    await webhook.send(event);
    expect(paymentProvider.calls).toHaveLength(1); // only the original signup charge
  });

  test('[bonus] 5 copies sent at the same time are applied exactly once', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    const event = aWebhook().paymentSucceeded().forInvoice(invoice).build();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => webhook.send(event)));

    expect(results.filter((r) => r.body.status === 'applied')).toHaveLength(1);
    expect(db.outboxOf(sub.id)).toHaveLength(1);
  });
});

test.describe('Webhooks arriving in the wrong order', () => {
  test('payment.failed AFTER payment.succeeded (same invoice) does not undo active', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    await webhook.send(aWebhook().paymentSucceeded().forInvoice(invoice).build());

    const late = await webhook.send(aWebhook().paymentFailed().forInvoice(invoice).build());

    expect(late.body.status).toBe('ignored');
    expect(db.getSubscription(sub.id)?.status).toBe('active');
    expect(db.getInvoice(invoice.id)?.status).toBe('paid');
  });

  test('refund BEFORE success is ignored; success still works after', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.proWithPaymentInProgress();
    expect((await webhook.send(aWebhook().paymentRefunded().forInvoice(invoice).build())).body.reason).toBe('invoice_not_paid');
    await webhook.send(aWebhook().paymentSucceeded().forInvoice(invoice).build());
    expect(db.getSubscription(sub.id)?.status).toBe('active');
  });

  test('refund of a paid invoice is recorded, status stays the same (our assumption)', async ({ webhook, given, db }) => {
    const { sub, invoice } = await given.activePro();
    await webhook.send(aWebhook().paymentRefunded().forInvoice(invoice).build());
    expect(db.getInvoice(invoice.id)?.status).toBe('refunded');
    expect(db.getSubscription(sub.id)?.status).toBe('active');
  });
});
