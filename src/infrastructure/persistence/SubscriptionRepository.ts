import { Subscription } from '../../domain/subscription/types';

export interface SubscriptionRepository {
  save(subscription: Subscription): Promise<void>;
  findById(id: string): Promise<Subscription | null>;
  findByCustomerId(customerId: string): Promise<Subscription[]>;
}
