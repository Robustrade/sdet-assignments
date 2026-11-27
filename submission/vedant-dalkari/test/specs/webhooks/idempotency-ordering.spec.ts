/**
 * Webhook idempotency, out-of-order stale events, refunds, and payload integrity specs.
 * Author: Vedant Dalkari
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SignedWebhookBuilder } from '../../framework/builders/SignedWebhookBuilder.js';
import { BillingTestHarness } from '../../framework/env/BillingTestHarness.js';

describe('Webhook Idempotency, Ordering, and Refund Lifecycle', () => {
  const activeHarnesses: BillingTestHarness[] = [];

  afterEach(async () => {
    while (activeHarnesses.length > 0) {
      const harness = activeHarnesses.pop();
      if (harness) {
        await harness.dispose();
      }
    }
  });

  // @feature:webhook-idempotency @smoke
  it('TC-039 processes duplicate payment.succeeded (same event_id) idempotently with zero side effects', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';

    const req = SignedWebhookBuilder.create()
      .withEventId('evt_idemp_ok')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const first = await harness.webhooks.sendSigned(req);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('processed');
    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('active');
    expect(harness.ledger.findInvoiceById(invoiceId)?.status).toBe('paid');

    const auditAfterFirst = harness.ledger.listAuditLogs(subscription.id).length;
    const notifierAfterFirst = harness.notifier.count();

    const second = await harness.webhooks.sendSigned(req);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('duplicate_ignored');
    expect(second.body.event_id).toBe('evt_idemp_ok');

    harness.verifier.assertTableCounts({
      webhook_events: 1,
      invoices: 1,
      payment_attempts: 2,
      subscription_audit_log: auditAfterFirst,
    });
    harness.verifier.assertNotifierCount(notifierAfterFirst);
    harness.verifier.assertGatewayCalls(1);
    harness.invariants.assertInvariant('INV-3');
  });

  // @feature:webhook-idempotency @sanity
  it('TC-040 processes duplicate payment.failed (same event_id) without double-incrementing failed_attempts', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterActive('cust_001');
    harness.scenario.seedPendingInvoice({
      invoiceId: 'inv_ren',
      subscriptionId: subscription.id,
      amountCents: 1900,
    });

    const baseAudit = harness.ledger.listAuditLogs(subscription.id).length;
    const baseNotifier = harness.notifier.count();

    const req = SignedWebhookBuilder.create()
      .withEventId('evt_idemp_fail')
      .paymentFailed()
      .forSubscription(subscription.id)
      .forInvoice('inv_ren')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const first = await harness.webhooks.sendSigned(req);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('processed');
    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('past_due');
    expect(harness.ledger.findSubscriptionById(subscription.id)?.failed_attempts).toBe(1);

    const second = await harness.webhooks.sendSigned(req);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('duplicate_ignored');

    const sub = harness.ledger.findSubscriptionById(subscription.id);
    expect(sub?.failed_attempts).toBe(1);
    expect(harness.ledger.listWebhookEvents('evt_idemp_fail')).toHaveLength(1);
    expect(
      harness.ledger.listPaymentAttempts(subscription.id).filter((a) => a.invoice_id === 'inv_ren'),
    ).toHaveLength(1);
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(baseAudit + 1);
    harness.verifier.assertNotifierCount(baseNotifier + 1);
    harness.verifier.assertGatewayCalls(1);
  });

  // @feature:webhook-idempotency @sanity
  it('TC-041 returns duplicate_ignored when an already-ignored stale event_id is replayed', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterActive('cust_001');
    const baseAudit = harness.ledger.listAuditLogs(subscription.id).length;

    const req = SignedWebhookBuilder.create()
      .withEventId('evt_stale_dup')
      .paymentFailed()
      .forSubscription(subscription.id)
      .forInvoice(invoice?.id ?? 'inv_001')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const first = await harness.webhooks.sendSigned(req);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('ignored_stale_or_invalid');
    expect(harness.ledger.listWebhookEvents('evt_stale_dup')[0]?.outcome).toBe('ignored_stale');

    const second = await harness.webhooks.sendSigned(req);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('duplicate_ignored');

    harness.verifier.assertTableCounts({
      webhook_events: 1,
      subscription_audit_log: baseAudit,
    });
  });

  // @feature:webhook-idempotency @sanity
  it('TC-042 treats distinct event_id payment.succeeded for already-paid invoice as ignored_stale', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';

    const evt1 = SignedWebhookBuilder.create()
      .withEventId('evt_1')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);
    expect((await harness.webhooks.sendSigned(evt1)).status).toBe(200);

    const attemptsBefore = harness.ledger.listPaymentAttempts(subscription.id).length;
    const auditBefore = harness.ledger.listAuditLogs(subscription.id).length;
    const notifierBefore = harness.notifier.count();

    const evt2 = SignedWebhookBuilder.create()
      .withEventId('evt_2')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const res2 = await harness.webhooks.sendSigned(evt2);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('ignored_stale_or_invalid');

    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('active');
    expect(harness.ledger.listInvoices(subscription.id)).toHaveLength(1);
    expect(harness.ledger.listInvoices(subscription.id)[0]?.status).toBe('paid');
    expect(harness.ledger.listPaymentAttempts(subscription.id)).toHaveLength(attemptsBefore);
    expect(harness.ledger.listWebhookEvents('evt_2')[0]?.outcome).toBe('ignored_stale');
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(auditBefore);
    harness.verifier.assertNotifierCount(notifierBefore);
  });

  // @feature:webhook-idempotency @regression
  it('TC-065 rejects or safely ignores reused event_id with altered payload hash without mutation', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';

    const first = SignedWebhookBuilder.create()
      .withEventId('evt_hash_1')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);
    const res1 = await harness.webhooks.sendSigned(first);
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('processed');

    const attemptsBefore = harness.ledger.listPaymentAttempts(subscription.id).length;
    const auditBefore = harness.ledger.listAuditLogs(subscription.id).length;

    const altered = SignedWebhookBuilder.create()
      .withEventId('evt_hash_1')
      .paymentFailed()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);
    const res2 = await harness.webhooks.sendSigned(altered);
    expect(res2.status).toBe(409);

    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('active');
    expect(harness.ledger.findInvoiceById(invoiceId)?.status).toBe('paid');
    expect(harness.ledger.listPaymentAttempts(subscription.id)).toHaveLength(attemptsBefore);
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(auditBefore);
    expect(harness.ledger.listWebhookEvents('evt_hash_1')).toHaveLength(1);
    harness.invariants.assertInvariant('INV-3');
  });

  // @feature:webhook-ordering @smoke
  it('TC-043 ignores out-of-order stale payment.failed after payment.succeeded on same invoice (INV-7)', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    harness.clock.plusFourteenDays();
    harness.gateway.approveNext('ch_growth_paid');
    await harness.api.runDueBilling();

    const invoice = harness.ledger.listInvoices(growth.id)[0];
    expect(invoice?.status).toBe('paid');
    const auditBefore = harness.ledger.listAuditLogs(growth.id).length;

    const staleFail = SignedWebhookBuilder.create()
      .withEventId('evt_ooo_fail')
      .paymentFailed()
      .forSubscription(growth.id)
      .forInvoice(invoice?.id ?? 'inv_001')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);

    const res = await harness.webhooks.sendSigned(staleFail);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored_stale_or_invalid');

    const sub = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(sub.status).toBe('active');
    expect(sub.failed_attempts).toBe(0);
    expect(harness.ledger.findInvoiceById(invoice?.id ?? '')?.status).toBe('paid');
    expect(harness.ledger.listWebhookEvents('evt_ooo_fail')[0]?.outcome).toBe('ignored_stale');
    expect(harness.ledger.listAuditLogs(growth.id)).toHaveLength(auditBefore);
    harness.verifier.assertGatewayCalls(1);
    harness.invariants.assertInvariant('INV-7');
  });

  // @feature:webhook-ordering @sanity
  it('TC-044 ignores delayed payment.failed for older paid invoice after newer cycle is paid', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterActive('cust_001');
    harness.clock.plusThirtyDays();
    harness.gateway.approveNext('ch_cycle_2');
    await harness.api.runDueBilling();

    const invoices = harness.ledger.listInvoices(subscription.id);
    expect(invoices).toHaveLength(2);
    const inv1 = invoices[0];
    const inv2 = invoices[1];
    const auditBefore = harness.ledger.listAuditLogs(subscription.id).length;

    const delayedFail = SignedWebhookBuilder.create()
      .withEventId('evt_old_fail')
      .paymentFailed()
      .forSubscription(subscription.id)
      .forInvoice(inv1?.id ?? 'inv_001')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const res = await harness.webhooks.sendSigned(delayedFail);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored_stale_or_invalid');

    const sub = harness.ledger.findSubscriptionById(subscription.id);
    expect(sub?.status).toBe('active');
    expect(sub?.failed_attempts).toBe(0);
    expect(harness.ledger.findInvoiceById(inv1?.id ?? '')?.status).toBe('paid');
    expect(harness.ledger.findInvoiceById(inv2?.id ?? '')?.status).toBe('paid');
    expect(harness.ledger.listWebhookEvents('evt_old_fail')[0]?.outcome).toBe('ignored_stale');
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(auditBefore);
  });

  // @feature:webhook-ordering @sanity
  it('TC-045 handles payment.refunded on paid invoice by canceling active sub and retaining attempt history', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterActive('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';

    const refundReq = SignedWebhookBuilder.create()
      .withEventId('evt_ref_1')
      .paymentRefunded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const refundAt = harness.clock.advanceDays(2);
    const res = await harness.webhooks.sendSigned(refundReq);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const sub = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(sub.status).toBe('canceled');
    expect(sub.canceled_at).toBe(refundAt);
    expect(harness.ledger.findInvoiceById(invoiceId)?.status).toBe('refunded');

    const attempts = harness.ledger.listPaymentAttempts(subscription.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('succeeded');
    expect(harness.ledger.listWebhookEvents('evt_ref_1')[0]?.outcome).toBe('processed');
    harness.verifier.assertLastAuditEdge(
      subscription.id,
      'active',
      'canceled',
      'payment_refunded_webhook',
    );

    harness.clock.advanceDays(28);
    await harness.api.runDueBilling();
    harness.verifier.assertGatewayCalls(1);
  });

  // @feature:webhook-ordering @sanity
  it('TC-046 handles payment.refunded on historical paid invoice while subscription is past_due', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice: inv1 } = await harness.scenario.createStarterActive('cust_001');
    harness.clock.plusThirtyDays();
    harness.gateway.declineNext('card_declined');
    await harness.api.runDueBilling();

    const inv2 = harness.ledger.listInvoices(subscription.id)[1];
    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('past_due');

    const refundReq = SignedWebhookBuilder.create()
      .withEventId('evt_ref_pd')
      .paymentRefunded()
      .forSubscription(subscription.id)
      .forInvoice(inv1?.id ?? 'inv_001')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const res = await harness.webhooks.sendSigned(refundReq);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('canceled');
    expect(harness.ledger.findInvoiceById(inv1?.id ?? '')?.status).toBe('refunded');
    expect(harness.ledger.findInvoiceById(inv2?.id ?? '')?.status).toBe('failed');
    expect(
      harness.ledger.listPaymentAttempts(subscription.id).some((a) => a.status === 'succeeded'),
    ).toBe(true);
    harness.verifier.assertLastAuditEdge(
      subscription.id,
      'past_due',
      'canceled',
      'payment_refunded_webhook',
    );
  });

  // @feature:webhook-ordering @regression
  it('TC-047 ignores payment.refunded targeting already-refunded invoice and canceled sub (INV-2)', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterActive('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';

    const firstRefund = SignedWebhookBuilder.create()
      .withEventId('evt_ref_first')
      .paymentRefunded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);
    expect((await harness.webhooks.sendSigned(firstRefund)).status).toBe(200);

    const auditCountAfterCancel = harness.ledger.listAuditLogs(subscription.id).length;

    const secondRefund = SignedWebhookBuilder.create()
      .withEventId('evt_ref_2')
      .paymentRefunded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);
    const res2 = await harness.webhooks.sendSigned(secondRefund);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('ignored_stale_or_invalid');

    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('canceled');
    expect(harness.ledger.findInvoiceById(invoiceId)?.status).toBe('refunded');
    expect(harness.ledger.listWebhookEvents('evt_ref_2')[0]?.outcome).toBe(
      'ignored_invalid_transition',
    );
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(auditCountAfterCancel);
    harness.invariants.assertInvariant('INV-2');
  });

  // @feature:webhook-ordering @regression
  it('TC-060 returns 404 for unknown subscription_id and 422 for plan-mismatched webhook amount', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterActive('cust_001');
    harness.gateway.resetCalls();

    const unknownSubReq = SignedWebhookBuilder.create()
      .withEventId('evt_unknown_sub')
      .paymentSucceeded()
      .forSubscription('sub_unknown')
      .forInvoice('inv_unknown')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);
    const resA = await harness.webhooks.sendSigned(unknownSubReq);
    expect(resA.status).toBe(404);

    const mismatchedAmountReq = SignedWebhookBuilder.create()
      .withEventId('evt_bad_amt')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoice?.id ?? 'inv_001')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);
    const resB = await harness.webhooks.sendSigned(mismatchedAmountReq);
    expect(resB.status).toBe(422);

    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('active');
    expect(harness.ledger.findInvoiceById(invoice?.id ?? '')?.amount_cents).toBe(1900);
    harness.verifier.assertGatewayCalls(0);
    harness.invariants.assertInvariant('INV-6');
  });

  // @feature:webhook-ordering @regression
  it('TC-067 exhausts past_due retries -> canceled when third failure arrives via payment.failed webhook', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    expect(invoice).toBeDefined();
    if (!invoice) {
      throw new Error('Expected failed invoice on starter past_due setup');
    }

    // Retry 1 fails via scheduler (failed_attempts = 2, remains past_due)
    harness.clock.plusOneDay();
    harness.gateway.declineNext('card_declined');
    await harness.api.runDueBilling();
    expect(harness.ledger.findSubscriptionById(subscription.id)?.failed_attempts).toBe(2);
    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('past_due');

    // Retry 2 fails via signed webhook (failed_attempts = 3 > maxRetries = 2 -> canceled)
    const canceledAt = harness.clock.plusOneDay();
    const webhookReq = SignedWebhookBuilder.create()
      .withEventId('evt_wh_exhaust')
      .paymentFailed()
      .forSubscription(subscription.id)
      .forInvoice(invoice.id)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const res = await harness.webhooks.sendSigned(webhookReq);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const finalSub = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(finalSub.status).toBe('canceled');
    expect(finalSub.failed_attempts).toBe(3);
    expect(finalSub.canceled_at).toBe(canceledAt);
    harness.verifier.assertLastAuditEdge(subscription.id, 'past_due', 'canceled', 'retries_exhausted');
    harness.verifier.assertGatewayCalls(2);
  });
});
