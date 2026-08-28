import { Subscription } from '../../domain/models/subscription';

export interface SubscriptionRepository {
  findById(id: string): Subscription | undefined;
  save(subscription: Subscription): void;
  delete(id: string): void;
}
