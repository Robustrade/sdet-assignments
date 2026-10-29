import type { SubscriptionRecord } from '../domain/Subscription';

export interface SubscriptionRepository {
  save(subscription: SubscriptionRecord): Promise<void>;
  findById(id: string): Promise<SubscriptionRecord | undefined>;
  list(): Promise<SubscriptionRecord[]>;
}
