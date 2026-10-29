import type { SubscriptionRecord, SubscriptionStatus } from '../../../src/domain/Subscription';
import type { PlanId } from '../../../src/domain/plans';

/**
 * Builder for stored subscription rows in an arbitrary state. It is the "arrange" path only:
 * it writes a record directly (via the repository) so lifecycle specs do not need to replay
 * a long API history to reach e.g. `past_due`. The behavior under test never uses it.
 */
export class SubscriptionRecordBuilder {
  private record: SubscriptionRecord = {
    id: 'sub_seed_001',
    customerId: 'cust_001',
    plan: 'pro',
    status: 'trialing',
    priceCents: 4900,
    currency: 'USD',
    paymentMethodId: 'pm_test_visa_4242',
    trialEndsAt: '2026-01-15T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  withId(id: string): this {
    return this.merge({ id });
  }

  inStatus(status: SubscriptionStatus): this {
    return this.merge({ status });
  }

  trialEndingAt(iso: string): this {
    return this.merge({ trialEndsAt: iso });
  }

  onPlan(plan: PlanId, priceCents: number): this {
    return this.merge({ plan, priceCents });
  }

  build(): SubscriptionRecord {
    return { ...this.record };
  }

  private merge(changes: Partial<SubscriptionRecord>): this {
    this.record = { ...this.record, ...changes };
    return this;
  }
}

export const aSubscriptionRecord = (): SubscriptionRecordBuilder => new SubscriptionRecordBuilder();
