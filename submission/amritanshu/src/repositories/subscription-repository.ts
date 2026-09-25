import type { Subscription } from "../domain/subscription.js";

export interface SubscriptionRepository {
  save(subscription: Subscription): void;
  findById(id: string): Subscription | undefined;
  findByCustomerId(customerId: string): Subscription[];
}