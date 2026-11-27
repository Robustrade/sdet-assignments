/**
 * API contract, creation/retrieval/cancellation, and validation error specifications.
 * Author: Vedant Dalkari
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SignupPayloadBuilder } from '../../framework/builders/SignupPayloadBuilder.js';
import type { ApiErrorBody } from '../../framework/clients/contracts.js';
import { DEFAULT_T0_ISO } from '../../framework/doubles/ControlledClock.js';
import { BillingTestHarness } from '../../framework/env/BillingTestHarness.js';

describe('Subscriptions HTTP API Contracts & Validation', () => {
  const activeHarnesses: BillingTestHarness[] = [];

  afterEach(async () => {
    while (activeHarnesses.length > 0) {
      const harness = activeHarnesses.pop();
      if (harness) {
        await harness.dispose();
      }
    }
  });

  // @feature:subscriptions-api @smoke
  it('TC-004 creates starter subscription with immediate approved charge and active state', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    harness.gateway.approveNext('ch_starter_004');
    const res = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_001')
        .withStarterPlan()
        .withPaymentMethod('pm_visa_4242')
        .build(),
    );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.plan).toBe('starter');
    expect(res.body.trial_ends_at).toBeNull();
    expect(res.body.failed_attempts).toBe(0);
    expect(res.body.canceled_at).toBeNull();
    expect(res.body.current_period_start).toBe(DEFAULT_T0_ISO);
    expect(res.body.current_period_end).toBe('2026-01-31T00:00:00.000Z');

    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 1,
      subscription_audit_log: 1,
    });
    const inv = harness.ledger.listInvoices(res.body.id)[0];
    expect(inv?.status).toBe('paid');
    expect(inv?.amount_cents).toBe(1900);
    expect(inv?.currency).toBe('USD');

    const att = harness.ledger.listPaymentAttempts(res.body.id)[0];
    expect(att?.status).toBe('succeeded');
    harness.verifier.assertLastAuditEdge(res.body.id, null, 'active');
    harness.verifier.assertGatewayCalls(1);
    harness.verifier.assertNotifierCount(1);
  });

  // @feature:subscriptions-api @sanity
  it('TC-005 creates growth subscription in deferred trialing state with zero initial charge', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const res = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_001')
        .withGrowthPlan()
        .withPaymentMethod('pm_visa_4242')
        .build(),
    );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('trialing');
    expect(res.body.plan).toBe('growth');
    expect(res.body.trial_ends_at).toBe('2026-01-15T00:00:00.000Z');
    expect(res.body.failed_attempts).toBe(0);
    expect(res.body.canceled_at).toBeNull();

    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 0,
      payment_attempts: 0,
      subscription_audit_log: 1,
    });
    harness.verifier.assertLastAuditEdge(res.body.id, null, 'trialing');
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(1);
  });

  // @feature:subscriptions-api @sanity
  it('TC-006 transitions starter subscription to past_due when immediate charge is declined', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    harness.gateway.declineNext('card_declined');
    const res = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_001')
        .withStarterPlan()
        .withPaymentMethod('pm_declined_0002')
        .build(),
    );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('past_due');
    expect(res.body.failed_attempts).toBe(1);
    expect(res.body.canceled_at).toBeNull();

    harness.verifier.assertTableCounts({
      subscriptions: 1,
      invoices: 1,
      payment_attempts: 1,
      subscription_audit_log: 1,
    });
    const inv = harness.ledger.listInvoices(res.body.id)[0];
    expect(inv?.status).toBe('failed');
    expect(inv?.amount_cents).toBe(1900);
    expect(inv?.currency).toBe('USD');

    const att = harness.ledger.listPaymentAttempts(res.body.id)[0];
    expect(att?.status).toBe('declined');
    expect(att?.failure_reason).toBe('card_declined');
    harness.verifier.assertLastAuditEdge(res.body.id, null, 'past_due');
    harness.verifier.assertGatewayCalls(1);
    harness.verifier.assertNotifierCount(1);
    harness.invariants.assertInvariant('INV-1');
  });

  // @feature:subscriptions-api @sanity
  it('TC-007 returns canonical snapshot from GET /subscriptions/:id matching SQLite row', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const created = await harness.scenario.createGrowthTrialing('cust_001');
    harness.gateway.resetCalls();

    const snapshot = await harness.verifier.assertApiMatchesDb(created.id);
    expect(snapshot.id).toBe(created.id);
    harness.verifier.assertGatewayCalls(0);
  });

  // @feature:subscriptions-api @sanity
  it('TC-008 rejects unknown plan on POST /subscriptions with 400 and zero side effects', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const res = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_001')
        .withPlan('enterprise')
        .withPaymentMethod('pm_visa_4242')
        .buildUntyped(),
    );

    expect(res.status).toBe(400);
    const errBody = res.body as unknown as ApiErrorBody;
    expect(JSON.stringify(errBody).toLowerCase()).toContain('plan');

    harness.verifier.assertTableCounts({
      subscriptions: 0,
      invoices: 0,
      payment_attempts: 0,
      subscription_audit_log: 0,
    });
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(0);
  });

  // @feature:subscriptions-api @regression
  it('TC-009 rejects missing or empty required fields on POST /subscriptions with 400', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const invalidPayloads: Record<string, unknown>[] = [
      SignupPayloadBuilder.create().forCustomer('').withStarterPlan().withPaymentMethod('pm_1').buildUntyped(),
      SignupPayloadBuilder.create().forCustomer('cust_001').withStarterPlan().withPaymentMethod('').buildUntyped(),
      SignupPayloadBuilder.create().forCustomer('cust_001').withPlan('').withPaymentMethod('pm_1').buildUntyped(),
      SignupPayloadBuilder.create().forCustomer('cust_001').withStarterPlan().withoutField('payment_method_id').buildUntyped(),
    ];

    for (const payload of invalidPayloads) {
      const res = await harness.api.createSubscription(payload);
      expect(res.status).toBe(400);
    }

    harness.verifier.assertTableCounts({
      subscriptions: 0,
      invoices: 0,
      payment_attempts: 0,
      subscription_audit_log: 0,
    });
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(0);
  });

  // @feature:subscriptions-api @sanity
  it('TC-010 rejects unknown customer_id on POST /subscriptions with 404', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const res = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_nonexistent_999')
        .withStarterPlan()
        .withPaymentMethod('pm_visa_4242')
        .build(),
    );

    expect(res.status).toBe(404);
    harness.verifier.assertTableCounts({
      subscriptions: 0,
      invoices: 0,
      payment_attempts: 0,
      subscription_audit_log: 0,
    });
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(0);
  });

  // @feature:subscriptions-api @regression
  it('TC-011 rejects malformed JSON body on POST /subscriptions with 400', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const res = await harness.api.createSubscriptionRaw('{customer_id: broken');
    expect(res.status).toBe(400);
    harness.verifier.assertTableCounts({
      subscriptions: 0,
      invoices: 0,
      payment_attempts: 0,
      subscription_audit_log: 0,
    });
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(0);
  });

  // @feature:subscriptions-api @regression
  it('TC-012 rejects GET /subscriptions/:id for nonexistent subscription with 404', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const res = await harness.api.getSubscription('sub_missing_404');
    expect(res.status).toBe(404);
    harness.verifier.assertTableCounts({ subscriptions: 0 });
    harness.verifier.assertGatewayCalls(0);
  });

  // @feature:subscriptions-api @regression
  it('TC-013 rejects POST /subscriptions/:id/cancel for nonexistent subscription with 404', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const res = await harness.api.cancelSubscription('sub_missing_404');
    expect(res.status).toBe(404);
    harness.verifier.assertTableCounts({
      subscriptions: 0,
      subscription_audit_log: 0,
    });
    harness.verifier.assertGatewayCalls(0);
    harness.verifier.assertNotifierCount(0);
  });

  // @feature:subscriptions-api @regression
  it('TC-014 rejects duplicate cancel on already-canceled subscription with 409', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const { subscription } = await harness.scenario.createStarterActive('cust_001');
    const canceledAtFirst = harness.clock.advanceHours(1);
    const firstCancel = await harness.api.cancelSubscription(subscription.id);
    expect(firstCancel.status).toBe(200);
    expect(firstCancel.body.canceled_at).toBe(canceledAtFirst);

    const notifierAfterFirstCancel = harness.notifier.count();
    harness.clock.advanceHours(1);
    const secondCancel = await harness.api.cancelSubscription(subscription.id);
    expect(secondCancel.status).toBe(409);

    const persisted = harness.ledger.findSubscriptionById(subscription.id);
    expect(persisted?.canceled_at).toBe(canceledAtFirst);
    expect(harness.ledger.listAuditLogs(subscription.id)).toHaveLength(2);
    harness.verifier.assertGatewayCalls(1);
    harness.verifier.assertNotifierCount(notifierAfterFirstCancel);
  });

  // @feature:subscriptions-api @regression
  it('TC-061 handles initial starter signup timeout cleanly and recovers on retry', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    harness.gateway.timeoutNext('socket_timeout');
    const signup = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_001')
        .withStarterPlan()
        .withPaymentMethod('pm_slow_1')
        .build(),
    );

    expect(signup.status).toBe(201);
    expect(signup.body.status).toBe('past_due');
    expect(signup.body.failed_attempts).toBe(1);

    const invAfterSignup = harness.ledger.listInvoices(signup.body.id);
    expect(invAfterSignup).toHaveLength(1);
    expect(invAfterSignup[0]?.status).toBe('failed');

    const attAfterSignup = harness.ledger.listPaymentAttempts(signup.body.id);
    expect(attAfterSignup).toHaveLength(1);
    expect(attAfterSignup[0]?.status).toBe('timeout');
    expect(attAfterSignup[0]?.failure_reason).toBe('socket_timeout');

    harness.clock.plusOneDay();
    harness.gateway.approveNext('ch_timeout_recovered');
    const runDue = await harness.api.runDueBilling();
    expect(runDue.status).toBe(200);

    const recovered = await harness.verifier.assertApiMatchesDb(signup.body.id);
    expect(recovered.status).toBe('active');
    expect(recovered.failed_attempts).toBe(0);
    expect(harness.ledger.listInvoices(signup.body.id)[0]?.status).toBe('paid');
    harness.verifier.assertGatewayCalls(2);
  });
});
