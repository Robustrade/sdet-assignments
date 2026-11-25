import { Subscription } from "../domain/Subscription";
import { SubscriptionRepository } from "./SubscriptionRepository";

export class InMemorySubscriptionRepository
  implements SubscriptionRepository {

  private subscriptions =
    new Map<string, Subscription>();

  save(subscription: Subscription): void {
    this.subscriptions.set(
      subscription.id,
      subscription
    );
  }

  findById(
    id: string
  ): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  update(subscription: Subscription): void {
    this.subscriptions.set(
      subscription.id,
      subscription
    );
  }
}