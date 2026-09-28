import type { Repositories } from '../../src/persistence/repositories';
import type { SubscriptionStatus } from '../../src/domain/types';
import type { SubscriptionApiClient } from './SubscriptionApiClient';

/**
 * Assertion layer: "what the API says" == "what the DB says" == "what the business expects".
 * Always reads the DB through repositories, never raw maps.
 */
export class ConsistencyVerifier {
  constructor(
    private readonly api: SubscriptionApiClient,
    private readonly repos: Repositories,
  ) {}

  async expectSubscriptionIn(id: string, expected: SubscriptionStatus): Promise<void> {
    const res = await this.api.getSubscription(id);
    const row = this.repos.subscriptions.getById(id);
    const latest = this.repos.invoices.latestForSubscription(id);

    expect(res.status).toBe(200);
    expect({ api: res.body.status, db: row.status }).toEqual({ api: expected, db: expected });
    expect(res.body).toMatchObject({
      id: row.id,
      customer_id: row.customerId,
      plan: row.plan,
      payment_method_id: row.paymentMethodId,
      trial_ends_at: row.trialEndsAt,
      current_period_end: row.currentPeriodEnd,
      canceled_at: row.canceledAt,
      updated_at: row.updatedAt,
    });
    expect(res.body.latest_invoice?.status ?? null).toBe(latest?.status ?? null);
  }

  /** Everything persisted for one subscription - handy for snapshot-style assertions. */
  snapshot(id: string) {
    return {
      subscription: this.repos.subscriptions.getById(id),
      invoices: this.repos.invoices.findBySubscription(id),
      payments: this.repos.payments.findBySubscription(id),
      audit: this.repos.audit.forSubscription(id),
      webhookEvents: this.repos.webhookEvents.all().filter((e) => e.subscriptionId === id),
    };
  }

  transitionsOf(id: string): string[] {
    return this.repos.audit
      .forSubscription(id)
      .filter((e) => e.action.startsWith('transition.'))
      .map((e) => `${e.fromStatus}->${e.toStatus}`);
  }
}
