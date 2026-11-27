/**
 * Persistence, schema DDL constraints, isolation, and invariant specifications.
 * Author: Vedant Dalkari
 */

import { afterEach, describe, expect, it } from 'vitest';
import { validateSchema } from '../../../scripts/validateSchema.js';
import { SignedWebhookBuilder } from '../../framework/builders/SignedWebhookBuilder.js';
import { SignupPayloadBuilder } from '../../framework/builders/SignupPayloadBuilder.js';
import { BillingTestHarness } from '../../framework/env/BillingTestHarness.js';

describe('Persistence, Schema Constraints, and Test Isolation', () => {
  const activeHarnesses: BillingTestHarness[] = [];

  afterEach(async () => {
    while (activeHarnesses.length > 0) {
      const harness = activeHarnesses.pop();
      if (harness) {
        await harness.dispose();
      }
    }
  });

  // @feature:persistence-invariants @smoke
  it('TC-001 validates SQLite schema DDL, foreign keys, and primary-key uniqueness', async () => {
    const report = await validateSchema();
    expect(report.foreignKeyEnforced).toBe(true);
    expect(report.primaryKeyEnforced).toBe(true);

    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    expect(harness.ledger.listTables()).toEqual([
      'customers',
      'invoices',
      'payment_attempts',
      'subscription_audit_log',
      'subscriptions',
      'webhook_events',
    ]);

    expect(harness.ledger.getTableColumns('subscriptions')).toEqual(
      expect.arrayContaining([
        'id',
        'customer_id',
        'plan',
        'status',
        'failed_attempts',
        'trial_ends_at',
        'current_period_start',
        'current_period_end',
        'canceled_at',
        'created_at',
        'updated_at',
      ]),
    );

    expect(() =>
      harness.ledger.executeRaw(
        `INSERT INTO subscriptions (id, customer_id, plan, status, payment_method_id, failed_attempts, trial_ends_at, current_period_start, current_period_end, canceled_at, created_at, updated_at)
         VALUES ('sub_orphan', 'cust_ghost', 'starter', 'active', 'pm_1', 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      ),
    ).toThrow(/FOREIGN KEY/i);

    harness.ledger.executeRaw(
      `INSERT INTO webhook_events (event_id, event_type, subscription_id, invoice_id, outcome, payload_hash, received_at)
       VALUES ('evt_pk_1', 'payment.succeeded', NULL, NULL, 'processed', 'hash_1', '2026-01-01T00:00:00.000Z')`,
    );

    expect(() =>
      harness.ledger.executeRaw(
        `INSERT INTO webhook_events (event_id, event_type, subscription_id, invoice_id, outcome, payload_hash, received_at)
         VALUES ('evt_pk_1', 'payment.succeeded', NULL, NULL, 'processed', 'hash_1', '2026-01-01T00:00:01.000Z')`,
      ),
    ).toThrow(/UNIQUE/i);
  });

  // @feature:persistence-invariants @sanity
  it('TC-003 guarantees per-test DB isolation after destructive operations in prior harness', async () => {
    const harnessA = await BillingTestHarness.create();
    const activeStarter = await harnessA.scenario.createStarterActive('cust_001');
    const cancelRes = await harnessA.api.cancelSubscription(activeStarter.subscription.id);
    expect(cancelRes.status).toBe(200);

    harnessA.gateway.declineNext('card_declined');
    const failedStarter = await harnessA.api.createSubscription(
      SignupPayloadBuilder.create().forCustomer('cust_002').withStarterPlan().build(),
    );
    expect(failedStarter.status).toBe(201);
    await harnessA.dispose();

    const harnessB = await BillingTestHarness.create();
    activeHarnesses.push(harnessB);

    harnessB.verifier.assertTableCounts({
      customers: 3,
      subscriptions: 0,
      invoices: 0,
      payment_attempts: 0,
      webhook_events: 0,
      subscription_audit_log: 0,
    });
    harnessB.verifier.assertGatewayCalls(0);
    harnessB.verifier.assertNotifierCount(0);
  });

  // @feature:persistence-invariants @sanity
  it('TC-052 verifies stage-by-stage LedgerInspector and INV-5 API-vs-DB parity across all 4 states', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001');
    await harness.verifier.assertApiMatchesDb(growth.id);
    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 0,
      payment_attempts: 0,
      subscription_audit_log: 1,
    });

    harness.clock.plusFourteenDays();
    harness.gateway.declineNext('expired_card');
    const failTick = await harness.api.runDueBilling();
    expect(failTick.status).toBe(200);

    const stage2 = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(stage2.status).toBe('past_due');
    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 1,
      subscription_audit_log: 2,
    });

    harness.clock.plusOneDay();
    harness.gateway.approveNext('ch_stage_recover');
    const okTick = await harness.api.runDueBilling();
    expect(okTick.status).toBe(200);

    const stage3 = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(stage3.status).toBe('active');
    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 2,
      subscription_audit_log: 3,
    });

    harness.clock.advanceDays(5);
    const cancelRes = await harness.api.cancelSubscription(growth.id);
    expect(cancelRes.status).toBe(200);

    const stage4 = await harness.verifier.assertApiMatchesDb(growth.id);
    expect(stage4.status).toBe('canceled');
    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 2,
      subscription_audit_log: 4,
    });
  });

  // @feature:persistence-invariants @sanity
  it('TC-053 verifies atomic writes and complete SQL rollback on mid-transaction audit failure', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    expect(invoice).toBeDefined();
    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 1,
      webhook_events: 0,
      subscription_audit_log: 1,
    });

    harness.ledger.executeRaw(`
      CREATE TRIGGER fail_audit_insert
      BEFORE INSERT ON subscription_audit_log
      BEGIN
        SELECT RAISE(ABORT, 'simulated_audit_write_failure');
      END;
    `);

    const signedWebhook = SignedWebhookBuilder.create()
      .withEventId('evt_tx_rollback_1')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoice?.id ?? 'inv_missing')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const failedTxRes = await harness.webhooks.sendSigned(signedWebhook);
    expect(failedTxRes.status).toBe(500);

    harness.ledger.executeRaw('DROP TRIGGER fail_audit_insert;');

    const rolledBackSub = harness.ledger.findSubscriptionById(subscription.id);
    expect(rolledBackSub?.status).toBe('past_due');
    expect(harness.ledger.findInvoiceById(invoice?.id ?? '')?.status).toBe('failed');
    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 1,
      webhook_events: 0,
      subscription_audit_log: 1,
    });
  });

  // @feature:persistence-invariants @sanity
  it('TC-054 satisfies InvariantGuard INV-1, INV-2, INV-6, and INV-8 across multi-stage lifecycle', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    await harness.scenario.createStarterActive('cust_001');
    const growth = await harness.scenario.createGrowthTrialing('cust_002');

    harness.clock.plusFourteenDays();
    harness.gateway.declineNext('insufficient_funds');
    await harness.api.runDueBilling();

    harness.clock.plusOneDay();
    harness.gateway.approveNext('ch_inv_guard_ok');
    await harness.api.runDueBilling();

    const growthCancel = await harness.api.cancelSubscription(growth.id);
    expect(growthCancel.status).toBe(200);

    const inv = harness.ledger.listInvoices(growth.id)[0];
    const strayWebhook = SignedWebhookBuilder.create()
      .withEventId('evt_inv_guard_stray')
      .paymentSucceeded()
      .forSubscription(growth.id)
      .forInvoice(inv?.id ?? 'inv_none')
      .withAmountCents(4900)
      .buildSignedRequest(harness.signer);
    const strayRes = await harness.webhooks.sendSigned(strayWebhook);
    expect(strayRes.status).toBe(200);

    harness.invariants.assertInvariant('INV-1');
    harness.invariants.assertInvariant('INV-2');
    harness.invariants.assertInvariant('INV-6');
    harness.invariants.assertInvariant('INV-8');
  });

  // @feature:persistence-invariants @sanity
  it('TC-055 satisfies InvariantGuard INV-3, INV-4, and INV-7 under duplicate and stale webhooks', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription, invoice } = await harness.scenario.createStarterPastDue('cust_001');
    const invoiceId = invoice?.id ?? 'inv_missing';

    const okWebhook = SignedWebhookBuilder.create()
      .withEventId('evt_storm_ok')
      .paymentSucceeded()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    await harness.webhooks.sendSigned(okWebhook);
    await harness.webhooks.sendSigned(okWebhook);

    const staleFailA = SignedWebhookBuilder.create()
      .withEventId('evt_storm_stale_1')
      .paymentFailed()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    const staleFailB = SignedWebhookBuilder.create()
      .withEventId('evt_storm_stale_2')
      .paymentFailed()
      .forSubscription(subscription.id)
      .forInvoice(invoiceId)
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);

    await harness.webhooks.sendSigned(staleFailA);
    await harness.webhooks.sendSigned(staleFailB);

    harness.invariants.assertInvariant('INV-3');
    harness.invariants.assertInvariant('INV-4');
    harness.invariants.assertInvariant('INV-7');
  });

  // @feature:persistence-invariants @regression
  it('TC-059 enforces cross-subscription blast-radius isolation for the same customer', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const subA = await harness.scenario.createStarterActive('cust_001');
    const subB = await harness.scenario.createGrowthTrialing('cust_001');

    const cancelA = await harness.api.cancelSubscription(subA.subscription.id);
    expect(cancelA.status).toBe(200);

    const failWebhookA = SignedWebhookBuilder.create()
      .withEventId('evt_blast_a')
      .paymentFailed()
      .forSubscription(subA.subscription.id)
      .forInvoice(subA.invoice?.id ?? 'inv_a')
      .withAmountCents(1900)
      .buildSignedRequest(harness.signer);
    const whRes = await harness.webhooks.sendSigned(failWebhookA);
    expect(whRes.status).toBe(200);

    const subBRow = harness.ledger.findSubscriptionById(subB.id);
    expect(subBRow?.status).toBe('trialing');
    expect(subBRow?.failed_attempts).toBe(0);
    expect(subBRow?.canceled_at).toBeNull();
    expect(harness.ledger.listInvoices(subB.id)).toHaveLength(0);
    expect(harness.ledger.listAuditLogs(subB.id)).toHaveLength(1);
  });
});
