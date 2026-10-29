import type { SubscriptionRecord } from '../domain/Subscription';
import type { SubscriptionRepository } from './SubscriptionRepository';

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly rows = new Map<string, SubscriptionRecord>();

  async save(subscription: SubscriptionRecord): Promise<void> {
    this.rows.set(subscription.id, { ...subscription });
  }

  async findById(id: string): Promise<SubscriptionRecord | undefined> {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }

  async list(): Promise<SubscriptionRecord[]> {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
}
