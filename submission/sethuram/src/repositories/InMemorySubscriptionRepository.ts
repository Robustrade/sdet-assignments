import { Subscription } from "../domain/Subscription";
import { SubscriptionRepository } from "./SubscriptionRepository";

export class InMemorySubscriptionRepository
  implements SubscriptionRepository {

  private readonly subscriptions =
    new Map<string, Subscription>();

  private clone(subscription: Subscription): Subscription {
    return {
      ...subscription,
      ...(subscription.trialEndsAt
        ? {
            trialEndsAt: new Date(subscription.trialEndsAt)
          }
        : {}),
      createdAt: new Date(subscription.createdAt),
      updatedAt: new Date(subscription.updatedAt)
    };
  }

  async save(subscription: Subscription): Promise<void> {
    this.subscriptions.set(
      subscription.id,
      this.clone(subscription)
    );
  }

  async findById(id: string): Promise<Subscription | null> {
    const subscription = this.subscriptions.get(id);

    return subscription
      ? this.clone(subscription)
      : null;
  }

  async findAll(): Promise<Subscription[]> {
    return Array.from(this.subscriptions.values()).map(
      subscription => this.clone(subscription)
    );
  }
}