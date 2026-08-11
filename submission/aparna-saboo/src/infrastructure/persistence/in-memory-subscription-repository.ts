import { Subscription } from '../../domain/models/subscription';
import { SubscriptionRepository } from '../../application/ports/subscription-repository';

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly subscriptions = new Map<string, Subscription>();

  findById(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  save(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, subscription);
  }

  delete(id: string): void {
    this.subscriptions.delete(id);
  }
}
