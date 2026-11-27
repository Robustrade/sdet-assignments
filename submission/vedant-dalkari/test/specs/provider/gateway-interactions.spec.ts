/**
 * External BillingGateway seam, PlanPolicy strategy, call counts/args, and timeout/decline specs.
 * Author: Vedant Dalkari
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SignedWebhookBuilder } from '../../framework/builders/SignedWebhookBuilder.js';
import { SignupPayloadBuilder } from '../../framework/builders/SignupPayloadBuilder.js';
import { BillingTestHarness } from '../../framework/env/BillingTestHarness.js';

describe('BillingGateway Mock Seam & PlanPolicy Strategy', () => {
  const activeHarnesses: BillingTestHarness[] = [];

  afterEach(async () => {
    while (activeHarnesses.length > 0) {
      const harness = activeHarnesses.pop();
      if (harness) {
        await harness.dispose();
      }
    }
  });

  // @feature:billing-plans @smoke
  it('TC-032 enforces PlanPolicy strategy pricing, trial duration, and retry-cap parity', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const starterPolicy = harness.planRegistry.resolve('starter');
    const growthPolicy = harness.planRegistry.resolve('growth');

    expect(starterPolicy.config.amountCents).toBe(1900);
    expect(starterPolicy.config.currency).toBe('USD');
    expect(starterPolicy.config.trialDays).toBe(0);
    expect(starterPolicy.config.maxRetries).toBe(2);

    expect(growthPolicy.config.amountCents).toBe(4900);
    expect(growthPolicy.config.currency).toBe('USD');
    expect(growthPolicy.config.trialDays).toBe(14);
    expect(growthPolicy.config.maxRetries).toBe(2);

    harness.gateway.approveNext('ch_plan_starter');
    const starterRes = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_001')
        .withStarterPlan()
        .withPaymentMethod('pm_1')
        .build(),
    );
    expect(starterRes.status).toBe(201);
    expect(starterRes.body.trial_ends_at).toBeNull();

    const growthRes = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_002')
        .withGrowthPlan()
        .withPaymentMethod('pm_2')
        .build(),
    );
    expect(growthRes.status).toBe(201);
    expect(growthRes.body.trial_ends_at).toBe('2026-01-15T00:00:00.000Z');

    harness.clock.plusFourteenDays();
    harness.gateway.approveNext('ch_plan_growth');
    const runRes = await harness.api.runDueBilling();
    expect(runRes.status).toBe(200);

    expect(harness.gateway.calls).toHaveLength(2);
    expect(harness.gateway.calls[0]?.amountCents).toBe(1900);
    expect(harness.gateway.calls[1]?.amountCents).toBe(4900);
    expect(harness.ledger.listInvoices(starterRes.body.id)[0]?.amount_cents).toBe(1900);
    expect(harness.ledger.listInvoices(growthRes.body.id)[0]?.amount_cents).toBe(4900);
    harness.invariants.assertInvariant('INV-6');
  });

  // @feature:payment-gateway-seam @smoke
  it('TC-048 verifies exact BillingGateway call count, arguments, and provider_reference on approved', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    harness.gateway.approveNext('ch_ref_001');
    const res = await harness.api.createSubscription(
      SignupPayloadBuilder.create()
        .forCustomer('cust_001')
        .withStarterPlan()
        .withPaymentMethod('pm_visa_4242')
        .build(),
    );
    expect(res.status).toBe(201);

    expect(harness.gateway.calls).toHaveLength(1);
    const call = harness.gateway.calls[0];
    expect(call).toEqual({
      sequence: 1,
      customerId: 'cust_001',
      amountCents: 1900,
      currency: 'USD',
      paymentMethodId: 'pm_visa_4242',
      idempotencyKey: expect.any(String) as string,
    });
    expect(call?.idempotencyKey.length).toBeGreaterThan(0);

    const attempts = harness.ledger.listPaymentAttempts(res.body.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.provider_reference).toBe('ch_ref_001');
  });

  // @feature:payment-gateway-seam @sanity
  it('TC-049 verifies exact BillingGateway args and failed persistence on scripted declined', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001', 'pm_bad_1');
    harness.clock.plusFourteenDays();
    harness.gateway.declineNext('do_not_honor');

    const runRes = await harness.api.runDueBilling();
    expect(runRes.status).toBe(200);

    expect(harness.gateway.calls).toHaveLength(1);
    const call = harness.gateway.calls[0];
    expect(call?.customerId).toBe('cust_001');
    expect(call?.amountCents).toBe(4900);
    expect(call?.currency).toBe('USD');
    expect(call?.paymentMethodId).toBe('pm_bad_1');
    expect(call?.idempotencyKey.length).toBeGreaterThan(0);

    const attempts = harness.ledger.listPaymentAttempts(growth.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('declined');
    expect(attempts[0]?.failure_reason).toBe('do_not_honor');
    expect(harness.ledger.listInvoices(growth.id)[0]?.status).toBe('failed');
    expect(harness.ledger.findSubscriptionById(growth.id)?.status).toBe('past_due');
  });

  // @feature:payment-gateway-seam @sanity
  it('TC-050 handles scripted BillingGateway timeout gracefully and persists timeout attempt', async () => {
    const harness = await BillingTestHarness.create();
    activeHarnesses.push(harness);

    const growth = await harness.scenario.createGrowthTrialing('cust_001', 'pm_slow_1');
    harness.clock.plusFourteenDays();
    harness.gateway.timeoutNext('gateway_timeout_504');

    const runRes = await harness.api.runDueBilling();
    expect(runRes.status).toBe(200);

    expect(harness.gateway.calls).toHaveLength(1);
    expect(harness.gateway.calls[0]?.amountCents).toBe(4900);

    const attempts = harness.ledger.listPaymentAttempts(growth.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('timeout');
    expect(attempts[0]?.failure_reason).toBe('gateway_timeout_504');
    expect(harness.ledger.listInvoices(growth.id)[0]?.status).toBe('failed');

    const sub = harness.ledger.findSubscriptionById(growth.id);
    expect(sub?.status).toBe('past_due');
    expect(sub?.failed_attempts).toBe(1);

    // Also verify rejected-promise network timeout on retry is caught and recorded cleanly
    harness.clock.plusOneDay();
    harness.gateway.rejectNext(new Error('ETIMEDOUT socket hangup'));
    const retryRes = await harness.api.runDueBilling();
    expect(retryRes.status).toBe(200);

    const retryAttempts = harness.ledger.listPaymentAttempts(growth.id);
    expect(retryAttempts).toHaveLength(2);
    expect(retryAttempts[1]?.status).toBe('timeout');
    expect(retryAttempts[1]?.failure_reason).toBe('ETIMEDOUT socket hangup');
    expect(harness.ledger.findSubscriptionById(growth.id)?.failed_attempts).toBe(2);
  });

  // @feature:payment-gateway-seam @sanity
  it('TC-051 enforces 0-call guarantee on non-billing actions and distinct idempotencyKey on retry', async () => {
    // Flow A: Non-billing operations never touch BillingGateway
    const harnessA = await BillingTestHarness.create();
    activeHarnesses.push(harnessA);

    const growth = await harnessA.scenario.createGrowthTrialing('cust_001');
    await harnessA.api.getSubscription(growth.id);
    await harnessA.api.createSubscription(
      SignupPayloadBuilder.create().forCustomer('cust_001').withPlan('unknown').buildUntyped(),
    );
    await harnessA.api.createSubscription(
      SignupPayloadBuilder.create().forCustomer('cust_missing').withStarterPlan().build(),
    );
    harnessA.scenario.seedPendingInvoice({
      invoiceId: 'inv_flow_a',
      subscriptionId: growth.id,
      amountCents: 4900,
    });
    const whReq = SignedWebhookBuilder.create()
      .withEventId('evt_flow_a_ok')
      .paymentSucceeded()
      .forSubscription(growth.id)
      .forInvoice('inv_flow_a')
      .withAmountCents(4900)
      .buildSignedRequest(harnessA.signer);
    await harnessA.webhooks.sendSigned(whReq);
    await harnessA.webhooks.sendSigned(whReq);
    await harnessA.api.cancelSubscription(growth.id);
    await harnessA.api.cancelSubscription(growth.id);

    expect(harnessA.gateway.callCount()).toBe(0);

    // Flow B: Failed starter signup + retry produce 2 distinct idempotency keys
    const harnessB = await BillingTestHarness.create();
    activeHarnesses.push(harnessB);

    const pastDue = await harnessB.scenario.createStarterPastDue('cust_001', 'pm_visa_4242');
    harnessB.clock.plusOneDay();
    harnessB.gateway.approveNext('ch_retry_distinct');
    await harnessB.api.runDueBilling();

    expect(harnessB.gateway.calls).toHaveLength(2);
    const key0 = harnessB.gateway.calls[0]?.idempotencyKey;
    const key1 = harnessB.gateway.calls[1]?.idempotencyKey;
    expect(key0).toBeTruthy();
    expect(key1).toBeTruthy();
    expect(key0).not.toBe(key1);
    expect(harnessB.gateway.calls[0]?.amountCents).toBe(1900);
    expect(harnessB.gateway.calls[1]?.amountCents).toBe(1900);

    const persistedKeys = harnessB.ledger
      .listPaymentAttempts(pastDue.subscription.id)
      .map((a) => a.idempotency_key);
    expect(persistedKeys).toEqual([key0, key1]);
    harnessB.invariants.assertInvariant('INV-4');
  });
});
