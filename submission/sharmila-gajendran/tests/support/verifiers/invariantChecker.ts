import { expect } from 'vitest';
import type { Subscription } from '../../../src/domain/types';
import type { Repositories } from '../../../src/persistence/repositories';
import type { SubscriptionApiClient } from '../clients/subscriptionApiClient';
import { isAllowedTransition } from '../expectedLifecycle';
import type { MockPaymentProvider } from '../mocks/mockPaymentProvider';
import { EXPECTED_PLANS, type PlanCode } from '../testData';
import type { DbVerifier } from './dbVerifier';

/**
 * Rules that must hold at every moment, whatever the scenario did.
 * Runs automatically after every test (see useTestContext) and at checkpoints in journeys.
 */
export class InvariantChecker {
  constructor(
    private readonly repos: Repositories,
    private readonly provider: MockPaymentProvider,
    private readonly api: SubscriptionApiClient,
    private readonly dbCheck: DbVerifier,
  ) {}

  async assertAll(): Promise<void> {
    for (const subscription of this.repos.subscriptions.findAll()) {
      await this.assertSubscription(subscription.id);
    }
    this.assertNoDuplicateKeys();
    this.assertOneProviderCallPerInvoice();
  }

  async assertSubscription(id: string): Promise<void> {
    const subscription = this.dbCheck.subscription(id);
    this.assertActiveHasSuccessfulPayment(subscription);
    this.assertCanceledFields(subscription);
    this.assertInvoiceAmountsMatchPlan(subscription);
    this.assertAuditTrailIsValid(subscription);
    await this.assertApiMatchesDb(subscription);
  }

  /** Never active without at least one successful (paid, possibly later refunded) payment. */
  private assertActiveHasSuccessfulPayment(subscription: Subscription): void {
    if (subscription.status !== 'active') {
      return;
    }
    const successful = this.dbCheck
      .invoices(subscription.id)
      .filter((invoice) => invoice.status === 'paid' || invoice.status === 'refunded');
    expect(successful.length, `${subscription.id} is active without a successful payment`).toBeGreaterThan(0);
  }

  private assertCanceledFields(subscription: Subscription): void {
    expect(subscription.canceledAt !== null, `${subscription.id}: canceled_at must be set only when canceled`).toBe(
      subscription.status === 'canceled',
    );
  }

  /** Every invoice charges the plan's price, so creation and billing use the same pricing rules. */
  private assertInvoiceAmountsMatchPlan(subscription: Subscription): void {
    const expected = EXPECTED_PLANS[subscription.plan as PlanCode];
    expect(expected, `unknown plan ${subscription.plan}`).toBeDefined();
    for (const invoice of this.dbCheck.invoices(subscription.id)) {
      expect({ amount: invoice.amountCents, currency: invoice.currency }, `invoice ${invoice.id}`).toEqual({
        amount: expected.priceCents,
        currency: expected.currency,
      });
    }
  }

  /**
   * The audit log is a continuous story: it starts with 'created' in trialing, each entry starts
   * where the previous one ended, every status change is an allowed transition (so nothing ever
   * leaves canceled), timestamps never go backwards, and it ends at the current status.
   */
  private assertAuditTrailIsValid(subscription: Subscription): void {
    const [created, ...rest] = this.dbCheck.auditTrail(subscription.id);
    expect(created, `${subscription.id} has no 'created' audit entry`).toMatchObject({
      kind: 'created',
      fromStatus: null,
      toStatus: 'trialing',
    });
    let status = created?.toStatus;
    let previousAt = created?.createdAt ?? '';
    for (const entry of rest) {
      expect(entry.fromStatus, `audit entry ${entry.id} does not follow on from the previous one`).toBe(status);
      if (entry.kind === 'transition') {
        expect(
          isAllowedTransition(entry.fromStatus, entry.toStatus),
          `${entry.fromStatus} -> ${entry.toStatus} is not an allowed transition`,
        ).toBe(true);
      } else {
        expect(entry.kind).toBe('event');
        expect(entry.toStatus, `event ${entry.trigger} must not change the status`).toBe(entry.fromStatus);
      }
      expect(entry.createdAt >= previousAt, `audit entry ${entry.id} goes back in time`).toBe(true);
      status = entry.toStatus;
      previousAt = entry.createdAt;
    }
    expect(status, `last audit entry must match the current status of ${subscription.id}`).toBe(subscription.status);
  }

  private async assertApiMatchesDb(subscription: Subscription): Promise<void> {
    const response = await this.api.getSubscription(subscription.id);
    expect(response.status).toBe(200);
    this.dbCheck.expectMatchesApi(response.data());
  }

  private assertNoDuplicateKeys(): void {
    const eventIds = this.repos.webhookEvents.findAll().map((event) => event.eventId);
    expect(new Set(eventIds).size, 'a webhook event id is stored twice').toBe(eventIds.length);
    const keys = this.repos.invoices.findAll().map((invoice) => invoice.idempotencyKey);
    expect(new Set(keys).size, 'an idempotency key is used twice').toBe(keys.length);
  }

  /** One provider call per invoice, matched by idempotency key: no extra charges, no missing ones. */
  private assertOneProviderCallPerInvoice(): void {
    const calledKeys = this.provider.calls.map((call) => call.idempotencyKey).sort();
    const invoiceIds = this.repos.invoices
      .findAll()
      .map((invoice) => invoice.id)
      .sort();
    expect(calledKeys, 'provider calls must match invoices one to one').toEqual(invoiceIds);
  }
}
