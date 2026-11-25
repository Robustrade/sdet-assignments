import { Subscription } from "../domain/Subscription";

export interface SubscriptionRepository {
  save(subscription: Subscription): void;

  findById(id: string): Subscription | undefined;

  update(subscription: Subscription): void;
}