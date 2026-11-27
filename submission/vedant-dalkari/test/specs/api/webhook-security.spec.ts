/**
 * Webhook transport security, raw-body HMAC verification, and schema validation specs.
 * Author: Vedant Dalkari
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SignedWebhookBuilder } from '../../framework/builders/SignedWebhookBuilder.js';
import { BillingTestHarness } from '../../framework/env/BillingTestHarness.js';

describe('Webhook Transport Security & Raw-Body HMAC Verification', () => {
  const activeHarnesses: BillingTestHarness[] = [];

  afterEach(async () => {
    while (activeHarnesses.length > 0) {
      const harness = activeHarnesses.pop();
      if (harness) {
        await harness.dispose();
      }
    }
  });

  // @feature:webhook-security @smoke
  it('TC-033 rejects webhook missing X-Provider-Signature with 401 and zero side effects', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterActive('cust_001');
    const initialNotifierCount = harness.notifier.count();
    harness.gateway.resetCalls();

    const unsignedReq = SignedWebhookBuilder.create()
      .withEventId('evt_nosig')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoice?.id ?? 'inv_001')
      .withAmountCents(1900)
      .withoutSignature()
      .buildSignedRequest(harness.signer);

    const res = await harness.webhooks.sendSigned(unsignedReq);
    expect(res.status).toBe(401);

    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 1,
      webhook_events: 0,
      subscription_audit_log: 1,
    });
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(initialNotifierCount);
  });

  // @feature:webhook-security @sanity
  it('TC-034 rejects invalid, wrong-secret, and malformed-prefix HMAC signatures with 401', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterActive('cust_001');
    const initialNotifierCount = harness.notifier.count();
    harness.gateway.resetCalls();

    const forgedVariants = [
      SignedWebhookBuilder.create()
        .withEventId('evt_bad_secret')
        .forSubscription(subscription.id)
        .forInvoice(invoice?.id ?? 'inv_001')
        .withWrongSecret('wrong_secret')
        .buildSignedRequest(harness.signer),
      SignedWebhookBuilder.create()
        .withEventId('evt_zero_digest')
        .forSubscription(subscription.id)
        .forInvoice(invoice?.id ?? 'inv_001')
        .withSignatureOverride(`sha256=${'0'.repeat(64)}`)
        .buildSignedRequest(harness.signer),
      SignedWebhookBuilder.create()
        .withEventId('evt_no_prefix')
        .forSubscription(subscription.id)
        .forInvoice(invoice?.id ?? 'inv_001')
        .withSignatureOverride('deadbeef')
        .buildSignedRequest(harness.signer),
    ];

    for (const req of forgedVariants) {
      const res = await harness.webhooks.sendSigned(req);
      expect(res.status).toBe(401);
    }

    harness.verifier.assertTableCounts({
      webhook_events: 0,
      subscription_audit_log: 1,
    });
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(initialNotifierCount);
  });

  // @feature:webhook-security @sanity
  it('TC-035 rejects tampered raw body whitespace, key order, and field mutations with 401', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';

    const whitespaceTamper = SignedWebhookBuilder.create()
      .withEventId('evt_tamp_ws')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .withTamperedBodyAfterSigning((raw) => raw.replace(':', ': '))
      .buildSignedRequest(harness.signer);

    const keyOrderRawA = JSON.stringify({
      event_id: 'evt_tamp_order',
      type: 'payment.succeeded',
      subscription_id: subscription.id,
      invoice_id: invoiceId,
      amount: 1900,
      currency: 'USD',
    });
    const reorderedRawB = JSON.stringify({
      currency: 'USD',
      amount: 1900,
      invoice_id: invoiceId,
      subscription_id: subscription.id,
      type: 'payment.succeeded',
      event_id: 'evt_tamp_order',
    });

    const amountTamper = SignedWebhookBuilder.create()
      .withEventId('evt_tamp_amt')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .withTamperedBodyAfterSigning((raw) => raw.replace('1900', '100'))
      .buildSignedRequest(harness.signer);

    const resA = await harness.webhooks.sendSigned(whitespaceTamper);
    const resB = await harness.webhooks.sendRaw(reorderedRawB, {
      'content-type': 'application/json',
      'x-provider-signature': harness.signer.sign(keyOrderRawA),
    });
    const resC = await harness.webhooks.sendSigned(amountTamper);

    expect(resA.status).toBe(401);
    expect(resB.status).toBe(401);
    expect(resC.status).toBe(401);

    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('past_due');
    harness.verifier.assertTableCounts({ webhook_events: 0 });
  });

  // @feature:webhook-security @sanity
  it('TC-036 accepts non-canonical pretty-printed JSON signed over exact raw bytes', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    const prettyReq = SignedWebhookBuilder.create()
      .withEventId('evt_pretty_ok')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoice?.id ?? 'inv_001')
      .withAmountCents(1900)
      .withPrettyFormatting(2)
      .buildSignedRequest(harness.signer);

    expect(prettyReq.rawBody).toContain('\n  ');
    const res = await harness.webhooks.sendSigned(prettyReq);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('active');
    const events = harness.ledger.listWebhookEvents('evt_pretty_ok');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('processed');
  });

  // @feature:webhook-security @sanity
  it('TC-037 returns 400 Bad Request when valid HMAC accompanies malformed JSON body', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const malformedReq = SignedWebhookBuilder.create()
      .withRawBodyOverride('{invalid-json')
      .buildSignedRequest(harness.signer);

    const res = await harness.webhooks.sendSigned(malformedReq);
    expect(res.status).toBe(400);

    harness.verifier.assertTableCounts({
      subscriptions: 0,
      invoices: 0,
      payment_attempts: 0,
      webhook_events: 0,
      subscription_audit_log: 0,
    });
    harness.verifier.assertGatewayCalls(0);
  });

  // @feature:webhook-security @sanity
  it('TC-038 returns 400 Bad Request for valid HMAC with invalid schema fields or amounts', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterActive('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';
    const baseNotifierCount = harness.notifier.count();
    harness.gateway.resetCalls();

    const invalidCases = [
      SignedWebhookBuilder.create().withEventId('').forSubscription(subscription.id).forInvoice(invoiceId).buildSignedRequest(harness.signer),
      SignedWebhookBuilder.create().withEventId('evt_bad_type').withType('charge.disputed').forSubscription(subscription.id).forInvoice(invoiceId).buildSignedRequest(harness.signer),
      SignedWebhookBuilder.create().withEventId('evt_zero_amt').forSubscription(subscription.id).forInvoice(invoiceId).withAmountCents(0).buildSignedRequest(harness.signer),
      SignedWebhookBuilder.create().withEventId('evt_neg_amt').forSubscription(subscription.id).forInvoice(invoiceId).withAmountCents(-100).buildSignedRequest(harness.signer),
      SignedWebhookBuilder.create().withEventId('evt_float_amt').forSubscription(subscription.id).forInvoice(invoiceId).withAmountCents(19.5).buildSignedRequest(harness.signer),
      SignedWebhookBuilder.create().withEventId('evt_empty_curr').forSubscription(subscription.id).forInvoice(invoiceId).withCurrency('').buildSignedRequest(harness.signer),
      SignedWebhookBuilder.create().withEventId('evt_no_inv').forSubscription(subscription.id).withoutField('invoice_id').buildSignedRequest(harness.signer),
    ];

    for (const req of invalidCases) {
      const res = await harness.webhooks.sendSigned(req);
      expect(res.status).toBe(400);
    }

    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 1,
      webhook_events: 0,
      subscription_audit_log: 1,
    });
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(baseNotifierCount);
  });
});
