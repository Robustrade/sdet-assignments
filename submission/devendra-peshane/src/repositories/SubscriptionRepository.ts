import type { Subscription } from "../models/Subscription";

export interface SubscriptionRepository {
  save(subscription: Subscription): void;
  findById(id: string): Subscription | undefined;
  findAll(): Subscription[];
}

export class InMemorySubscriptionRepository
  implements SubscriptionRepository
{
  private readonly subscriptions = new Map<string, Subscription>();

  save(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  findById(id: string): Subscription | undefined {
    const subscription = this.subscriptions.get(id);
    return subscription ? { ...subscription } : undefined;
  }

  findAll(): Subscription[] {
    return Array.from(this.subscriptions.values()).map(
      (subscription) => ({ ...subscription })
    );
  }
}
