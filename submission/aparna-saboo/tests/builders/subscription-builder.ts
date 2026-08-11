import { Subscription } from '../../src/domain/models/subscription';

export class SubscriptionBuilder {
  private data: Partial<Subscription> = {};

  withDefaults(): this {
    this.data = {
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      status: 'trialing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this;
  }

  withId(id: string): this {
    this.data.id = id;
    return this;
  }

  withStatus(status: Subscription['status']): this {
    this.data.status = status;
    return this;
  }

  build(): Subscription {
    return {
      id: this.data.id ?? 'sub_001',
      customerId: this.data.customerId ?? 'cust_001',
      plan: this.data.plan ?? 'pro',
      status: this.data.status ?? 'trialing',
      createdAt: this.data.createdAt ?? new Date().toISOString(),
      updatedAt: this.data.updatedAt ?? new Date().toISOString(),
    };
  }
}
