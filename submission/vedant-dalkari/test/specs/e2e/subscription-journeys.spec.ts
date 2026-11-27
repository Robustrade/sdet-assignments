/**
 * End-to-end multi-stage customer journeys and concurrent race condition specs.
 * Author: Vedant Dalkari
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubscriptionSnapshot, WebhookResponseBody } from '../../framework/clients/contracts.js';
import { CustomerSpecBuilder } from '../../framework/builders/CustomerSpecBuilder.js';
import { SignedWebhookBuilder } from '../../framework/builders/SignedWebhookBuilder.js';
import { SignupPayloadBuilder } from '../../framework/builders/SignupPayloadBuilder.js';
import { DEFAULT_T0_ISO } from '../../framework/doubles/ControlledClock.js';
import { BillingTestHarness } from '../../framework/env/BillingTestHarness.js';

describe('End-to-End Customer Billing Journeys & Concurrency Races', () => {
  const activeHarnesses: BillingTestHarness[] = [];

  afterEach(async () => {
    while (activeHarnesses.length > 0) {
      const harness = activeHarnesses.pop();
      if (harness) {
        await harness.dispose();
      }
    }
  });

  // @journey @feature:subscriptions-api @feature:billing-plans @feature:persistence-invariants
  it('TC-002 validates minimal seeded customer starter happy path end-to-end', async () => {
    const minCustomer = CustomerSpecBuilder.create()
      .withId('cust_min_01')
      .withEmail('min@example.com')
      .withName('Min User')
      .withCreatedAt(DEFAULT_T0_ISO)
      .build();

    const harness = await BillingTestHarness.create({ customers: [minCustomer] });
    activeHarnesses.push(harness);

    harness.gateway.approveNext('ch_min_01');
    const postRes = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_min_01')
        .withStarterPlan()
        .withPaymentMethod('pm_visa_4242')
        .build(),
    );
    expect(postRes.status).toBe(201);

    const getRes = await harness.verifier.assertApiMatchesDb(postRes.body.id);
    expect(getRes.status).toBe('active');

    harness.verifier.assertTableCounts({
      customers: 1,
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 1,
      webhook_events: 0,
      subscription_audit_log: 1,
    });
    const inv = harness.ledger.listInvoices(postRes.body.id)[0];
    expect(inv?.status).toBe('paid');
    expect(inv?.amount_cents).toBe(1900);
    expect(harness.ledger.listPaymentAttempts(postRes.body.id)[0]?.status).toBe('succeeded');
    harness.verifier.assertGatewayCalls(1);
    harness.verifier.assertNotifierCount(1);
  });

  // @journey @feature:lifecycle-state-machine @feature:payment-gateway-seam @feature:webhook-idempotency @feature:persistence-invariants
  it('TC-056 Journey A: growth trial -> fail -> retry -> webhook fail -> webhook recovery -> cancel -> stray webhook', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');

    // T0 + 14d: initial trial-end charge fails
    harness.clock.plusFourteenDays();
    harness.gateway.declineNext('insufficient_funds');
    await harness.api.runDueBilling();
    expect(harness.ledger.findSubscriptionById(growth.id)?.status).toBe('past_due');

    // T0 + 15d: retry succeeds
    harness.clock.plusOneDay();
    harness.gateway.approveNext('ch_journey_a_1');
    await harness.api.runDueBilling();
    expect(harness.ledger.findSubscriptionById(growth.id)?.status).toBe('active');

    // T0 + 45d: renewal invoice fails via webhook, then recovers via webhook
    harness.clock.plusThirtyDays();
    harness.scenario.seedPendingInvoice({
      invoiceId: 'inv_ja_ren',
      subscriptionId: growth.id,
      amountCents: 4900,
    });

    const failWebhook = SignedWebhookBuilder.create()
      .withEventId('evt_ja_fail')
      .paymentFailed()
      .forSubscription(growth.id)
      .forInvoice('inv_ja_ren')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);
    expect((await harness.webhooks.sendSigned(failWebhook)).status).toBe(200);
    expect(harness.ledger.findSubscriptionById(growth.id)?.status).toBe('past_due');

    const okWebhook = SignedWebhookBuilder.create()
      .withEventId('evt_ja_ok')
      .paymentSucceeded()
      .forSubscription(growth.id)
      .forInvoice('inv_ja_ren')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);
    expect((await harness.webhooks.sendSigned(okWebhook)).status).toBe(200);
    expect(harness.ledger.findSubscriptionById(growth.id)?.status).toBe('active');

    // Cancel and reject stray post-cancel webhook
    expect((await harness.api.cancelSubscription(growth.id)).status).toBe(200);

    const strayWebhook = SignedWebhookBuilder.create()
      .withEventId('evt_ja_stray')
      .paymentSucceeded()
      .forSubscription(growth.id)
      .forInvoice('inv_ja_ren')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);
    const strayRes = await harness.webhooks.sendSigned(strayWebhook);
    expect(strayRes.status).toBe(200);
    expect(strayRes.body.status).toBe('ignored_stale_or_invalid');

    const finalSub = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(finalSub.status).toBe('canceled');

    const invoices = harness.ledger.listInvoices(growth.id);
    expect(invoices).toHaveLength(2);
    expect(invoices.every((inv) => inv.status === 'paid')).toBe(true);

    expect(harness.ledger.listPaymentAttempts(growth.id)).toHaveLength(4);
    expect(harness.ledger.listWebhookEvents()).toHaveLength(3);
    expect(harness.ledger.listAuditLogs(growth.id)).toHaveLength(6);
    harness.verifier.assertGatewayCalls(2);
    await harness.invariants.assertAll();
  });

  // @journey @feature:lifecycle-state-machine @feature:payment-gateway-seam @feature:persistence-invariants
  it('TC-057 Journey B: starter immediate active -> timeout -> retry exhaustion -> canceled', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterActive('cust_002');

    // T0 + 30d: recurring charge times out -> past_due (failed_attempts = 1)
    harness.clock.plusThirtyDays();
    harness.gateway.timeoutNext('gateway_timeout_504');
    await harness.api.runDueBilling();

    // T0 + 31d: retry 1 declined -> past_due (failed_attempts = 2)
    harness.clock.plusOneDay();
    harness.gateway.declineNext('card_declined');
    await harness.api.runDueBilling();

    // T0 + 32d: retry 2 declined -> canceled (failed_attempts = 3)
    harness.clock.plusOneDay();
    harness.gateway.declineNext('card_declined');
    await harness.api.runDueBilling();

    // T0 + 33d: canceled sub skipped even if gateway would approve
    harness.clock.plusOneDay();
    harness.gateway.approveNext('ch_post_cancel_unused');
    await harness.api.runDueBilling();

    const finalSub = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(finalSub.status).toBe('canceled');
    expect(finalSub.failed_attempts).toBe(3);

    const invoices = harness.ledger.listInvoices(subscription.id);
    expect(invoices).toHaveLength(2);
    expect(invoices[0]?.status).toBe('paid');
    expect(invoices[1]?.status).toBe('failed');

    const attempts = harness.ledger.listPaymentAttempts(subscription.id);
    expect(attempts.map((a) => a.status)).toEqual(['succeeded', 'timeout', 'declined', 'declined']);

    const auditEdges = harness.ledger
      .listAuditLogs(subscription.id)
      .map((a) => `${String(a.from_status)}->${a.to_status}`);
    expect(auditEdges).toEqual(['null->active', 'active->past_due', 'past_due->canceled']);
    harness.verifier.assertGatewayCalls(4);
    await harness.invariants.assertAll();
  });

  // @journey @feature:billing-plans @feature:webhook-ordering @feature:persistence-invariants
  it('TC-058 Journey C: growth trial -> approved activation -> payment.refunded cancellation', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_003');
    harness.clock.plusFourteenDays();
    harness.gateway.approveNext('ch_jc_ok');
    await harness.api.runDueBilling();

    const inv = harness.ledger.listInvoices(growth.id)[0];
    expect(inv?.status).toBe('paid');

    const refundReq = SignedWebhookBuilder.create()
      .withEventId('evt_jc_refund')
      .paymentRefunded()
      .forSubscription(growth.id)
      .forInvoice(inv?.id ?? 'inv_jc')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);
    expect((await harness.webhooks.sendSigned(refundReq)).status).toBe(200);

    harness.clock.plusThirtyDays();
    await harness.api.runDueBilling();

    const finalSub = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(finalSub.status).toBe('canceled');

    const persistedInv = harness.ledger.findInvoiceById(inv?.id ?? '');
    expect(persistedInv?.status).toBe('refunded');
    expect(persistedInv?.amount_cents).toBe(4900);
    expect(harness.ledger.listPaymentAttempts(growth.id)).toHaveLength(1);
    expect(harness.ledger.listPaymentAttempts(growth.id)[0]?.status).toBe('succeeded');
    expect(harness.ledger.listWebhookEvents('evt_jc_refund')[0]?.outcome).toBe('processed');

    const auditEdges = harness.ledger
      .listAuditLogs(growth.id)
      .map((a) => `${String(a.from_status)}->${a.to_status}`);
    expect(auditEdges).toEqual(['null->trialing', 'trialing->active', 'active->canceled']);
    harness.verifier.assertGatewayCalls(1);
    await harness.invariants.assertAll();
  });

  // @journey @feature:webhook-idempotency @feature:persistence-invariants
  it('TC-062 handles concurrent duplicate webhook delivery via Promise.all without duplicate side effects', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';
    const notifierBefore = harness.notifier.count();

    const req = SignedWebhookBuilder.create()
      .withEventId('evt_conc_dup')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const [resA, resB] = await Promise.all([
      harness.webhooks.sendSigned(req),
      harness.webhooks.sendSigned(req),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect([resA.body.status, resB.body.status].sort()).toEqual(['duplicate_ignored', 'processed']);

    expect(harness.ledger.listWebhookEvents('evt_conc_dup')).toHaveLength(1);
    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('active');
    expect(harness.ledger.findInvoiceById(invoiceId)?.status).toBe('paid');
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(2);
    harness.verifier.assertNotifierCount(notifierBefore + 1);
    await harness.invariants.assertAll();
  });

  // @journey @feature:webhook-ordering @feature:lifecycle-state-machine @feature:persistence-invariants
  it('TC-063 resolves concurrent competing payment.succeeded vs payment.failed race coherently', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    harness.scenario.seedPendingInvoice({
      invoiceId: 'inv_race',
      subscriptionId: growth.id,
      amountCents: 4900,
    });

    const winReq = SignedWebhookBuilder.create()
      .withEventId('evt_win')
      .paymentSucceeded()
      .forSubscription(growth.id)
      .forInvoice('inv_race')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);

    const loseReq = SignedWebhookBuilder.create()
      .withEventId('evt_lose')
      .paymentFailed()
      .forSubscription(growth.id)
      .forInvoice('inv_race')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);

    const [resWin, resLose] = await Promise.all([
      harness.webhooks.sendSigned(winReq),
      harness.webhooks.sendSigned(loseReq),
    ]);

    expect(resWin.status).toBe(200);
    expect(resLose.status).toBe(200);

    const finalSub = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(finalSub.status).toBe('active');
    expect(finalSub.failed_attempts).toBe(0);
    expect(harness.ledger.findInvoiceById('inv_race')?.status).toBe('paid');
    await harness.invariants.assertAll();
  });

  // @journey @feature:subscriptions-api @feature:lifecycle-state-machine @feature:persistence-invariants
  it('TC-064 resolves concurrent cancel API vs payment.succeeded webhook into terminal canceled state', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    harness.scenario.seedPendingInvoice({
      invoiceId: 'inv_t_race',
      subscriptionId: growth.id,
      amountCents: 4900,
    });

    const whReq = SignedWebhookBuilder.create()
      .withEventId('evt_cancel_race')
      .paymentSucceeded()
      .forSubscription(growth.id)
      .forInvoice('inv_t_race')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);

    const [cancelRes, whRes] = await Promise.all([
      harness.api.cancelSubscription(growth.id),
      harness.webhooks.sendSigned(whReq),
    ]);

    expect(cancelRes.status).toBe(200);
    expect(whRes.status).toBe(200);

    const finalSub = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(finalSub.status).toBe('canceled');
    await harness.invariants.assertAll();
  });

  // @journey @feature:subscriptions-api @feature:webhook-security @feature:persistence-invariants
  it('TC-068 serves real TCP HTTP requests and raw-body HMAC webhooks over an active Node http.Server', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const server = createServer(harness.app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const addr = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const createRes = await fetch(`${baseUrl}/subscriptions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          SignupPayloadBuilder.create()
            .forCustomer('cust_001')
            .withGrowthPlan()
            .withPaymentMethod('pm_live_tcp')
            .build(),
        ),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as SubscriptionSnapshot;
      expect(created.status).toBe('trialing');

      harness.scenario.seedPendingInvoice({
        invoiceId: 'inv_live_tcp',
        subscriptionId: created.id,
        amountCents: 4900,
      });

      const signed = SignedWebhookBuilder.create()
        .withEventId('evt_live_tcp_1')
        .paymentSucceeded()
        .forSubscription(created.id)
        .forInvoice('inv_live_tcp')
        .withAmountCents(4900)
        .withPrettyFormatting(2)
        .buildSignedRequest(harness.signer);

      const badSigRes = await fetch(`${baseUrl}/webhooks/payment-provider`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-provider-signature': `sha256=${'0'.repeat(64)}`,
        },
        body: signed.rawBody,
      });
      expect(badSigRes.status).toBe(401);

      const whRes = await fetch(`${baseUrl}/webhooks/payment-provider`, {
        method: 'POST',
        headers: signed.headers,
        body: signed.rawBody,
      });
      expect(whRes.status).toBe(200);
      const whBody = (await whRes.json()) as WebhookResponseBody;
      expect(whBody.status).toBe('processed');

      const getRes = await fetch(`${baseUrl}/subscriptions/${created.id}`);
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as SubscriptionSnapshot;
      expect(fetched.status).toBe('active');

      const cancelRes = await fetch(`${baseUrl}/subscriptions/${created.id}/cancel`, {
        method: 'POST',
      });
      expect(cancelRes.status).toBe(200);

      const finalSub = await harness.verifier.assertApiMatchesDb(created.id);
      expect(finalSub.status).toBe('canceled');
      await harness.invariants.assertAll();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  });
});
