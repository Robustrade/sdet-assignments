/**
 * In-Memory Subscription Repository
 */

import { Subscription, SubscriptionStatus } from '../../domain/subscription/types';
import { InMemoryDatabase } from './InMemoryDatabase';
import { SubscriptionRepository } from './SubscriptionRepository';

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  constructor(private db: InMemoryDatabase) {}

  async save(subscription: Subscription): Promise<void> {
    // Deep clone to avoid reference issues
    this.db.subscriptions.set(subscription.id, { ...subscription });
  }

  async findById(id: string): Promise<Subscription | null> {
    const sub = this.db.subscriptions.get(id);
    return sub ? { ...sub } : null;
  }

  async findByCustomerId(customerId: string): Promise<Subscription[]> {
    return Array.from(this.db.subscriptions.values()).filter(
      (sub) => sub.customer_id === customerId
    );
  }

  updateStatus(id: string, status: SubscriptionStatus): void {
    const subscription = this.db.subscriptions.get(id);
    if (subscription) {
      subscription.status = status;
      if (status === 'canceled') {
        subscription.canceled_at = new Date();
      }
      this.db.subscriptions.set(id, subscription);
    }
  }

  delete(id: string): void {
    this.db.subscriptions.delete(id);
  }
}
