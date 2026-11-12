import { expect } from 'vitest';
import type { Invoice, SubscriptionStatus } from '../../../src/domain/types';
import type { SubscriptionDto } from '../../../src/http/subscriptionDto';
import { aSubscriptionRequest } from '../builders/subscriptionRequestBuilder';
import type { SubscriptionApiClient } from '../clients/subscriptionApiClient';
import type { FakeClock } from '../fakes/fakeClock';
import type { MockPaymentProvider } from '../mocks/mockPaymentProvider';
import { CUSTOMER_1, EXPECTED_PLANS, type CustomerRef, type PlanCode } from '../testData';
import type { DbVerifier } from '../verifiers/dbVerifier';
import type { InvariantChecker } from '../verifiers/invariantChecker';

/** Reusable "given" steps, so specs read as scenarios instead of setup code. */
export class SubscriptionSteps {
  constructor(
    private readonly api: SubscriptionApiClient,
    private readonly clock: FakeClock,
    private readonly provider: MockPaymentProvider,
    private readonly dbCheck: DbVerifier,
    private readonly invariants: InvariantChecker,
  ) {}

  async create(plan: PlanCode, customer: CustomerRef = CUSTOMER_1): Promise<SubscriptionDto> {
    const response = await this.api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan(plan).build());
    expect(response.status, `create ${plan} subscription`).toBe(201);
    return response.data();
  }

  async trialingPro(customer: CustomerRef = CUSTOMER_1): Promise<SubscriptionDto> {
    const subscription = await this.create('pro', customer);
    expect(subscription.status).toBe('trialing');
    return subscription;
  }

  /** Basic is charged on create; the next charge succeeds. */
  async activeBasic(customer: CustomerRef = CUSTOMER_1): Promise<SubscriptionDto> {
    this.provider.respondWith('succeed');
    const subscription = await this.create('basic', customer);
    expect(subscription.status).toBe('active');
    return subscription;
  }

  /** Basic whose first charge is declined: past_due with one failed attempt. */
  async pastDueBasic(customer: CustomerRef = CUSTOMER_1): Promise<SubscriptionDto> {
    this.provider.respondWith('decline');
    const subscription = await this.create('basic', customer);
    expect(subscription.status).toBe('past_due');
    return subscription;
  }

  /** Pro whose trial has ended and whose first charge is waiting for a webhook. */
  async proWithPendingInvoice(): Promise<{ subscription: SubscriptionDto; invoice: Invoice }> {
    const subscription = await this.trialingPro();
    this.provider.respondWith('pending');
    await this.endTrial();
    return { subscription, invoice: this.dbCheck.pendingInvoice(subscription.id) };
  }

  async endTrial(): Promise<number> {
    return this.advanceAndBill(EXPECTED_PLANS.pro.trialDays);
  }

  async runBilling(): Promise<number> {
    const response = await this.api.runBilling();
    expect(response.status).toBe(200);
    return response.data().attempted;
  }

  async advanceAndBill(days: number): Promise<number> {
    this.clock.advanceDays(days);
    return this.runBilling();
  }

  async current(subscriptionId: string): Promise<SubscriptionDto> {
    const response = await this.api.getSubscription(subscriptionId);
    expect(response.status).toBe(200);
    return response.data();
  }

  async statusOf(subscriptionId: string): Promise<SubscriptionStatus> {
    return (await this.current(subscriptionId)).status;
  }

  /** G1 checkpoint: status as expected, API = DB, and every invariant still holds. */
  async checkpoint(subscriptionId: string, expectedStatus: SubscriptionStatus): Promise<SubscriptionDto> {
    const subscription = await this.current(subscriptionId);
    expect(subscription.status).toBe(expectedStatus);
    this.dbCheck.expectMatchesApi(subscription);
    await this.invariants.assertSubscription(subscriptionId);
    return subscription;
  }
}
