import { expect } from 'vitest';
import type { SubscriptionApiClient } from '../clients/SubscriptionApiClient';
import type { SubscriptionView } from '../clients/contracts';
import type { DbInspector } from './DbInspector';

const COMPARED_FIELDS = [
  'customer_id',
  'plan',
  'payment_method_id',
  'status',
  'trial_ends_at',
  'current_period_end',
  'retry_count',
  'canceled_at',
] as const satisfies readonly (keyof SubscriptionView)[];

export class SubscriptionAssertions {
  constructor(
    private readonly api: SubscriptionApiClient,
    private readonly db: DbInspector,
  ) {}

  /**
   * INV-8: what a client sees through the API equals what is persisted. Call after
   * every significant step, not just at creation. Returns the view for further checks.
   */
  async expectConsistent(subscriptionId: string): Promise<SubscriptionView> {
    const res = await this.api.get(subscriptionId);
    expect(res.status, `GET /subscriptions/${subscriptionId}`).toBe(200);

    const row = this.db.subscription(subscriptionId);
    expect(row, `subscriptions row ${subscriptionId}`).toBeDefined();
    for (const field of COMPARED_FIELDS) {
      expect(res.body[field], `API vs DB mismatch on ${field}`).toEqual(row![field]);
    }
    return res.body;
  }

  /** Transitions recorded for a subscription, in order, as "from->to" (creation is "∅->trialing"). */
  transitionsOf(subscriptionId: string): string[] {
    return this.db.auditLog(subscriptionId).map((e) => `${e.from_status ?? '∅'}->${e.to_status}`);
  }
}
