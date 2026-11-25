
import { Subscription } from "../domain/Subscription";

export interface SubscriptionRepository {
  save(subscription: Subscription): Promise<void>;
  findById(id: string): Promise<Subscription | null>;
  findAll(): Promise<Subscription[]>;
}
