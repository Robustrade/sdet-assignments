
import { Subscription } from "../domain/Subscription";
import { SubscriptionRepository } from "./SubscriptionRepository";

export class InMemorySubscriptionRepository
  implements SubscriptionRepository {

  private readonly subscriptions = new Map<string, Subscription>();

  async save(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.id, {
      ...subscription,
      createdAt: new Date(subscription.createdAt),
      updatedAt: new Date(subscription.updatedAt)
    });
  }

  async findById(id: string): Promise<Subscription | null> {
    const subscription = this.subscriptions.get(id);

    return subscription
      ? {
          ...subscription,
          createdAt: new Date(subscription.createdAt),
          updatedAt: new Date(subscription.updatedAt)
        }
      : null;
  }

  async findAll(): Promise<Subscription[]> {
    return Array.from(this.subscriptions.values()).map(
      subscription => ({
        ...subscription,
        createdAt: new Date(subscription.createdAt),
        updatedAt: new Date(subscription.updatedAt)
      })
    );
  }
}
