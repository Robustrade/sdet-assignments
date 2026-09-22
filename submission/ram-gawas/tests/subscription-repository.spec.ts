import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database';
import { SubscriptionRepository } from '../src/repositories/subscription-repository';

describe('SubscriptionRepository', () => {
  let repository: SubscriptionRepository;

  beforeEach(() => {
    const db = createDatabase();
    repository = new SubscriptionRepository(db);
  });

  it('saves and retrieves a subscription', () => {
    repository.save({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      state: 'trialing',
      paymentMethodId: 'pm_001',
    });

    const subscription = repository.findById('sub_001');

    expect(subscription).toEqual({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      state: 'trialing',
      paymentMethodId: 'pm_001',
    });
  });

  it('updates subscription state', () => {
    repository.save({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      state: 'trialing',
      paymentMethodId: 'pm_001',
    });

    repository.updateState('sub_001', 'active');

    const subscription = repository.findById('sub_001');

    expect(subscription?.state).toBe('active');
  });
});