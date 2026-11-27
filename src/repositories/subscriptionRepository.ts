export interface SubscriptionRecord {
  id: string;
  customerId: string;
  plan: string;
  status: string;
  priceCents: number;
  trialDays: number;
  retryCount: number;
}

export class SubscriptionRepository {
  private subscriptions = new Map<string, SubscriptionRecord>();

  save(subscription: SubscriptionRecord): SubscriptionRecord {
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  findById(id: string): SubscriptionRecord | undefined {
    return this.subscriptions.get(id);
  }

  findAll(): SubscriptionRecord[] {
    return Array.from(this.subscriptions.values());
  }

  delete(id: string): boolean {
    return this.subscriptions.delete(id);
  }
}