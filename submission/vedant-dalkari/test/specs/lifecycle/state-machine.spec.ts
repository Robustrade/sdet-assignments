/**
 * Lifecycle state machine, all 7 legal transitions, retry caps, impossible transitions,
 * compile-time @ts-expect-error status guard, and 14-day trial boundary specs.
 * Author: Vedant Dalkari
 */

import { afterEach, describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../../../src/domain/errors.js';
import { SignedWebhookBuilder } from '../../framework/builders/SignedWebhookBuilder.js';
import { BillingTestHarness } from '../../framework/env/BillingTestHarness.js';

describe('Subscription Lifecycle State Machine & Transitions', () => {
  const activeHarnesses: BillingTestHarness[] = [];

  afterEach(async () => {
    while (activeHarnesses.length > 0) {
      const harness = activeHarnesses.pop();
      if (harness) {
        await harness.dispose();
      }
    }
  });

  // @feature:lifecycle-state-machine @smoke
  it('TC-015 transitions trialing -> active via scheduler when trial ends with approved charge', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    harness.clock.plusFourteenDays();
    harness.gateway.approveNext('ch_trial_ok');

    const runRes = await harness.api.runDueBilling();
    expect(runRes.status).toBe(200);
    expect(runRes.body.processed_count).toBe(1);

    const sub = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(sub.status).toBe('active');
    expect(sub.failed_attempts).toBe(0);
    expect(sub.current_period_start).toBe('2026-01-15T00:00:00.000Z');
    expect(sub.current_period_end).toBe('2026-02-14T00:00:00.000Z');

    const invoices = harness.ledger.listInvoices(growth.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.status).toBe('paid');
    expect(invoices[0]?.amount_cents).toBe(4900);
    expect(invoices[0]?.currency).toBe('USD');

    const attempts = harness.ledger.listPaymentAttempts(growth.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('succeeded');

    harness.verifier.assertTableCounts({ subscription_audit_log: 2 });
    harness.verifier.assertLastAuditEdge(growth.id, 'trialing', 'active');
    harness.verifier.assertGatewayCalls(1);
  });

  // @feature:lifecycle-state-machine @sanity
  it('TC-016 transitions trialing -> active via signed payment.succeeded webhook', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    harness.scenario.seedPendingInvoice({
      invoiceId: 'inv_trial_1',
      subscriptionId: growth.id,
      amountCents: 4900,
    });

    const req = SignedWebhookBuilder.create()
      .withEventId('evt_trial_ok')
      .paymentSucceeded()
      .forSubscription(growth.id)
      .forInvoice('inv_trial_1')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);

    const whRes = await harness.webhooks.sendSigned(req);
    expect(whRes.status).toBe(200);
    expect(whRes.body.status).toBe('processed');

    const sub = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(sub.status).toBe('active');
    expect(sub.failed_attempts).toBe(0);
    expect(harness.ledger.findInvoiceById('inv_trial_1')?.status).toBe('paid');
    expect(harness.ledger.listPaymentAttempts(growth.id)[0]?.status).toBe('succeeded');
    expect(harness.ledger.listWebhookEvents('evt_trial_ok')[0]?.outcome).toBe('processed');
    harness.verifier.assertLastAuditEdge(growth.id, 'trialing', 'active');
    harness.verifier.assertGatewayCalls(0);
  });

  // @feature:lifecycle-state-machine @sanity
  it('TC-017 transitions trialing -> past_due via scheduler when trial-end charge declines', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    harness.clock.plusFourteenDays();
    harness.gateway.declineNext('expired_card');

    const runRes = await harness.api.runDueBilling();
    expect(runRes.status).toBe(200);

    const sub = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(sub.status).toBe('past_due');
    expect(sub.failed_attempts).toBe(1);

    const inv = harness.ledger.listInvoices(growth.id)[0];
    expect(inv?.status).toBe('failed');
    expect(inv?.amount_cents).toBe(4900);
    expect(inv?.currency).toBe('USD');

    const att = harness.ledger.listPaymentAttempts(growth.id)[0];
    expect(att?.status).toBe('declined');
    expect(att?.failure_reason).toBe('expired_card');

    harness.verifier.assertTableCounts({ subscription_audit_log: 2 });
    harness.verifier.assertLastAuditEdge(growth.id, 'trialing', 'past_due');
    harness.verifier.assertGatewayCalls(1);
    harness.verifier.assertNotifierCount(2);
  });

  // @feature:lifecycle-state-machine @sanity
  it('TC-018 transitions active -> past_due via scheduler when recurring charge declines', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterActive('cust_001');
    harness.clock.plusThirtyDays();
    harness.gateway.declineNext('insufficient_funds');

    const runRes = await harness.api.runDueBilling();
    expect(runRes.status).toBe(200);

    const sub = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(sub.status).toBe('past_due');
    expect(sub.failed_attempts).toBe(1);

    const invoices = harness.ledger.listInvoices(subscription.id);
    expect(invoices).toHaveLength(2);
    expect(invoices[0]?.status).toBe('paid');
    expect(invoices[1]?.status).toBe('failed');

    const attempts = harness.ledger.listPaymentAttempts(subscription.id);
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.status)).toEqual(['succeeded', 'declined']);

    harness.verifier.assertLastAuditEdge(subscription.id, 'active', 'past_due');
    harness.verifier.assertGatewayCalls(2);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-019 transitions active -> past_due via signed payment.failed webhook', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterActive('cust_001');
    harness.scenario.seedPendingInvoice({
      invoiceId: 'inv_ren_1',
      subscriptionId: subscription.id,
      amountCents: 1900,
    });

    const req = SignedWebhookBuilder.create()
      .withEventId('evt_ren_fail')
      .paymentFailed()
      .forSubscription(subscription.id)
      .forInvoice('inv_ren_1')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const whRes = await harness.webhooks.sendSigned(req);
    expect(whRes.status).toBe(200);
    expect(whRes.body.status).toBe('processed');

    const sub = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(sub.status).toBe('past_due');
    expect(sub.failed_attempts).toBe(1);
    expect(harness.ledger.findInvoiceById('inv_ren_1')?.status).toBe('failed');
    expect(harness.ledger.listWebhookEvents('evt_ren_fail')[0]?.outcome).toBe('processed');
    harness.verifier.assertLastAuditEdge(subscription.id, 'active', 'past_due');
    harness.verifier.assertGatewayCalls(1);
  });

  // @feature:lifecycle-state-machine @sanity
  it('TC-020 transitions past_due -> active via scheduler retry when gateway approves', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterPastDue('cust_001');
    harness.clock.plusOneDay();
    harness.gateway.approveNext('ch_retry_ok');

    const runRes = await harness.api.runDueBilling();
    expect(runRes.status).toBe(200);

    const sub = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(sub.status).toBe('active');
    expect(sub.failed_attempts).toBe(0);

    const invoices = harness.ledger.listInvoices(subscription.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.status).toBe('paid');

    const attempts = harness.ledger.listPaymentAttempts(subscription.id);
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.status)).toEqual(['declined', 'succeeded']);

    harness.verifier.assertLastAuditEdge(subscription.id, 'past_due', 'active');
    harness.verifier.assertGatewayCalls(2);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-021 transitions past_due -> active via signed payment.succeeded webhook', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    const invoiceId = invoice?.id ?? 'inv_001';

    const req = SignedWebhookBuilder.create()
      .withEventId('evt_retry_ok')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const whRes = await harness.webhooks.sendSigned(req);
    expect(whRes.status).toBe(200);
    expect(whRes.body.status).toBe('processed');

    const sub = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(sub.status).toBe('active');
    expect(sub.failed_attempts).toBe(0);
    expect(harness.ledger.findInvoiceById(invoiceId)?.status).toBe('paid');
    expect(harness.ledger.listWebhookEvents('evt_retry_ok')[0]?.outcome).toBe('processed');
    harness.verifier.assertLastAuditEdge(subscription.id, 'past_due', 'active');
    harness.verifier.assertGatewayCalls(1);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-022 transitions past_due -> canceled exactly at maxRetries=2 and skips future ticks', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterPastDue('cust_001');
    expect(subscription.failed_attempts).toBe(1);

    // Retry 1 (maxRetries - 1): stays past_due
    harness.clock.plusOneDay();
    harness.gateway.declineNext('card_declined');
    await harness.api.runDueBilling();
    const afterRetry1 = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(afterRetry1.status).toBe('past_due');
    expect(afterRetry1.failed_attempts).toBe(2);

    // Retry 2 (maxRetries): exhausts and cancels
    const exhaustedAt = harness.clock.plusOneDay();
    harness.gateway.declineNext('card_declined');
    await harness.api.runDueBilling();
    const afterRetry2 = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(afterRetry2.status).toBe('canceled');
    expect(afterRetry2.failed_attempts).toBe(3);
    expect(afterRetry2.canceled_at).toBe(exhaustedAt);
    harness.verifier.assertLastAuditEdge(subscription.id, 'past_due', 'canceled');

    // Post-exhaustion tick (maxRetries + 1): skipped completely
    harness.clock.plusOneDay();
    harness.gateway.approveNext('ch_should_never_fire');
    await harness.api.runDueBilling();
    const afterRetry3 = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(afterRetry3.status).toBe('canceled');
    harness.verifier.assertGatewayCalls(3);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-023 recovers past_due -> active when exact final retry (maxRetries=2) succeeds', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterPastDue('cust_001');

    harness.clock.plusOneDay();
    harness.gateway.declineNext('card_declined');
    await harness.api.runDueBilling();
    const afterRetry1 = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(afterRetry1.status).toBe('past_due');
    expect(afterRetry1.failed_attempts).toBe(2);

    harness.clock.plusOneDay();
    harness.gateway.approveNext('ch_final_retry_ok');
    await harness.api.runDueBilling();
    const afterRetry2 = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(afterRetry2.status).toBe('active');
    expect(afterRetry2.failed_attempts).toBe(0);
    expect(afterRetry2.canceled_at).toBeNull();
    expect(harness.ledger.listInvoices(subscription.id)[0]?.status).toBe('paid');
    expect(harness.ledger.listPaymentAttempts(subscription.id).map((a) => a.status)).toEqual([
      'declined',
      'declined',
      'succeeded',
    ]);
    harness.verifier.assertGatewayCalls(3);
  });

  // @feature:lifecycle-state-machine @sanity
  it('TC-024 transitions active -> canceled via API and suppresses future recurring billing', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterActive('cust_001');
    const canceledAt = harness.clock.advanceDays(5);

    const cancelRes = await harness.api.cancelSubscription(subscription.id);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('canceled');
    expect(cancelRes.body.canceled_at).toBe(canceledAt);
    harness.verifier.assertTableCounts({ subscription_audit_log: 2 });
    harness.verifier.assertLastAuditEdge(subscription.id, 'active', 'canceled');

    harness.clock.advanceDays(25);
    await harness.api.runDueBilling();

    expect(harness.ledger.listInvoices(subscription.id)).toHaveLength(1);
    expect(harness.ledger.listPaymentAttempts(subscription.id)).toHaveLength(1);
    harness.verifier.assertGatewayCalls(1);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-025 transitions trialing -> canceled via API and suppresses trial-end billing', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    const canceledAt = harness.clock.advanceDays(3);

    const cancelRes = await harness.api.cancelSubscription(growth.id);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('canceled');
    expect(cancelRes.body.canceled_at).toBe(canceledAt);
    harness.verifier.assertTableCounts({ subscription_audit_log: 2 });
    harness.verifier.assertLastAuditEdge(growth.id, 'trialing', 'canceled');

    harness.clock.advanceDays(11);
    await harness.api.runDueBilling();

    expect(harness.ledger.listInvoices(growth.id)).toHaveLength(0);
    expect(harness.ledger.listPaymentAttempts(growth.id)).toHaveLength(0);
    harness.verifier.assertGatewayCalls(0);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-026 rejects/ignores impossible transition canceled -> active via stray payment.succeeded webhook', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterActive('cust_001');
    await harness.api.cancelSubscription(subscription.id);
    const auditCountAtCancel = harness.ledger.listAuditLogs(subscription.id).length;

    const stray = SignedWebhookBuilder.create()
      .withEventId('evt_zombie_ok')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoice?.id ?? 'inv_001')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const res = await harness.webhooks.sendSigned(stray);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored_stale_or_invalid');

    const persisted = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(persisted.status).toBe('canceled');
    expect(harness.ledger.listWebhookEvents('evt_zombie_ok')[0]?.outcome).toBe(
      'ignored_invalid_transition',
    );
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(auditCountAtCancel);
    expect(harness.ledger.listInvoices(subscription.id)).toHaveLength(1);
    expect(harness.ledger.listPaymentAttempts(subscription.id)).toHaveLength(1);
    harness.verifier.assertGatewayCalls(1);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-027 rejects/ignores impossible transition canceled -> past_due via webhook and run-due', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    await harness.api.cancelSubscription(growth.id);
    const auditCountAtCancel = harness.ledger.listAuditLogs(growth.id).length;

    const strayFail = SignedWebhookBuilder.create()
      .withEventId('evt_zombie_fail')
      .paymentFailed()
      .forSubscription(growth.id)
      .forInvoice('inv_nonexistent_trial')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);

    const res = await harness.webhooks.sendSigned(strayFail);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored_stale_or_invalid');

    harness.clock.plusFourteenDays();
    await harness.api.runDueBilling();

    const persisted = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(persisted.status).toBe('canceled');
    expect(persisted.failed_attempts).toBe(0);
    expect(harness.ledger.listWebhookEvents('evt_zombie_fail')[0]?.outcome).toBe(
      'ignored_invalid_transition',
    );
    expect(harness.ledger.listAuditLogs(growth.id)).toHaveLength(auditCountAtCancel);
    harness.verifier.assertGatewayCalls(0);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-028 prevents trialing -> active when trial-end charge fails via scheduler or webhook (INV-1)', async () => {
    // Run A: scheduler decline
    const harnessA = await BillingTestHarness.create();
    activeHarnesses.push(harnessA);
    const growthA = await harnessA.scenario.createGrowthTrialing('cust_001');
    harnessA.clock.plusFourteenDays();
    harnessA.gateway.declineNext('card_declined');
    await harnessA.api.runDueBilling();

    expect(harnessA.ledger.findSubscriptionById(growthA.id)?.status).toBe('past_due');
    expect(harnessA.ledger.listInvoices(growthA.id).every((i) => i.status !== 'paid')).toBe(true);
    expect(harnessA.ledger.listPaymentAttempts(growthA.id).every((a) => a.status !== 'succeeded')).toBe(true);
    harnessA.invariants.assertInvariant('INV-1');

    // Run B: payment.failed webhook on pending trial invoice
    const harnessB = await BillingTestHarness.create();
    activeHarnesses.push(harnessB);
    const growthB = await harnessB.scenario.createGrowthTrialing('cust_002');
    harnessB.scenario.seedPendingInvoice({
      invoiceId: 'inv_t',
      subscriptionId: growthB.id,
      amountCents: 4900,
    });
    const failReq = SignedWebhookBuilder.create()
      .withEventId('evt_trial_fail_wh')
      .paymentFailed()
      .forSubscription(growthB.id)
      .forInvoice('inv_t')
      .withAmountCents(4900)
      .buildSignedRequest(harnessB.signer);
    const whRes = await harnessB.webhooks.sendSigned(failReq);
    expect(whRes.status).toBe(200);
    expect(harnessB.ledger.findSubscriptionById(growthB.id)?.status).toBe('past_due');
    expect(harnessB.ledger.listInvoices(growthB.id).every((i) => i.status !== 'paid')).toBe(true);
    harnessB.invariants.assertInvariant('INV-1');
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-029 rejects past_due -> canceled via cancel API (409) and illegal LifecycleEngine edges', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterPastDue('cust_001');
    const cancelRes = await harness.api.cancelSubscription(subscription.id);
    expect(cancelRes.status).toBe(409);
    expect(harness.ledger.findSubscriptionById(subscription.id)?.status).toBe('past_due');
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(1);

    expect(() => harness.lifecycleEngine.transition('active', 'signup_trial')).toThrow(
      InvalidTransitionError,
    );
    expect(() =>
      harness.lifecycleEngine.transition('canceled', 'payment_succeeded_webhook'),
    ).toThrow(InvalidTransitionError);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-030 enforces compile-time @ts-expect-error guard on unbranded status mutation', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const attemptUnbrandedObject = (): void => {
      harness.subscriptionRepo.commitTransition(
        'sub_unbranded',
        // @ts-expect-error Unbranded transition object literal must fail TypeScript compilation
        { fromStatus: 'trialing', toStatus: 'active', trigger: 'trial_charge_succeeded' },
        { updated_at: harness.clock.nowIso() },
      );
    };

    const attemptRawString = (): void => {
      harness.subscriptionRepo.commitTransition(
        'sub_unbranded',
        // @ts-expect-error Raw status string literal must fail TypeScript compilation
        'active',
        { updated_at: harness.clock.nowIso() },
      );
    };

    expect(attemptUnbrandedObject).toThrow(InvalidTransitionError);
    expect(attemptRawString).toThrow(InvalidTransitionError);
  });

  // @feature:billing-plans @sanity
  it('TC-031 enforces exact 14-day growth trial boundary off-by-one (14d - 1ms vs 14d)', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');

    // Tick 1: 1ms before 14 days exact -> 2026-01-14T23:59:59.999Z
    harness.clock.setIso('2026-01-14T23:59:59.999Z');
    const earlyRun = await harness.api.runDueBilling();
    expect(earlyRun.status).toBe(200);
    expect(earlyRun.body.processed_count).toBe(0);
    expect(harness.ledger.findSubscriptionById(growth.id)?.status).toBe('trialing');
    expect(harness.ledger.listInvoices(growth.id)).toHaveLength(0);
    expect(harness.ledger.listPaymentAttempts(growth.id)).toHaveLength(0);
    harness.verifier.assertGatewayCalls(0);

    // Tick 2: +1ms to exact T0 + 14d -> 2026-01-15T00:00:00.000Z
    const exactEnd = harness.clock.plusOneMs();
    expect(exactEnd).toBe('2026-01-15T00:00:00.000Z');
    harness.gateway.approveNext('ch_exact_trial_end');
    const exactRun = await harness.api.runDueBilling();
    expect(exactRun.status).toBe(200);
    expect(exactRun.body.processed_count).toBe(1);

    const active = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(active.status).toBe('active');
    const inv = harness.ledger.listInvoices(growth.id)[0];
    expect(inv?.status).toBe('paid');
    expect(inv?.amount_cents).toBe(4900);
    expect(inv?.currency).toBe('USD');
    expect(harness.ledger.listPaymentAttempts(growth.id)).toHaveLength(1);
    harness.verifier.assertGatewayCalls(1);
  });

  // @feature:lifecycle-state-machine @regression
  it('TC-066 renews active subscription via scheduler on due billing period without spurious state churn', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterActive('cust_001');
    const renewalStart = harness.clock.plusThirtyDays();
    harness.gateway.approveNext('ch_renewal_ok');

    const runRes = await harness.api.runDueBilling();
    expect(runRes.status).toBe(200);
    expect(runRes.body.processed_count).toBe(1);

    const renewed = await harness.verifier.assertApiMatchesDb(subscription.id);
    expect(renewed.status).toBe('active');
    expect(renewed.failed_attempts).toBe(0);
    expect(renewed.current_period_start).toBe(renewalStart);
    expect(renewed.current_period_end).toBe('2026-03-02T00:00:00.000Z');

    const invoices = harness.ledger.listInvoices(subscription.id);
    expect(invoices).toHaveLength(2);
    expect(invoices.every((item) => item.status === 'paid')).toBe(true);
    expect(harness.ledger.listPaymentAttempts(subscription.id)).toHaveLength(2);
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(1);
    harness.verifier.assertGatewayCalls(2);
  });
});
