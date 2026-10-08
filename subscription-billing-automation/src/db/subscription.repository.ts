import { Subscription, SubscriptionSnapshot } from '../domain/models/subscription.model';
import { SubscriptionStatus } from '../domain/state/subscription-state.interface';
import { ActiveState } from '../domain/state/active.state';
import { CanceledState } from '../domain/state/canceled.state';
import { PastDueState } from '../domain/state/past-due.state';
import { TrialingState } from '../domain/state/trialing.state';

export class SubscriptionRepository {
  private readonly records = new Map<string, SubscriptionSnapshot>();

  save(subscription: Subscription): void {
    this.records.set(subscription.id, subscription.snapshot());
  }

  findById(id: string): Subscription | undefined {
    const record = this.records.get(id);
    return record ? this.hydrate(record) : undefined;
  }

  all(): SubscriptionSnapshot[] {
    return [...this.records.values()].map((record) => ({ ...record, history: [...record.history] }));
  }

  private hydrate(record: SubscriptionSnapshot): Subscription {
    const states: Record<SubscriptionStatus, () => ActiveState | CanceledState | PastDueState | TrialingState> = {
      trialing: () => new TrialingState(),
      active: () => new ActiveState(),
      past_due: () => new PastDueState(),
      canceled: () => new CanceledState(),
    };
    return new Subscription(
      record.id,
      record.customerId,
      record.plan,
      record.paymentMethodId,
      states[record.status](),
      record.trialEndsAt,
      record.createdAt,
      record.history,
    );
  }
}
