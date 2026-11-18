import db from '../../src/database/connection';
import { SubscriptionRepository } from '../../src/repositories/subscription.repository';

describe('Subscription Repository', () => {
  const repository = new SubscriptionRepository();

  beforeEach(() => {
    db.prepare('DELETE FROM subscriptions').run();
  });

  test('should create and retrieve a subscription', () => {
    const subscription = repository.create(
      {
        customer_id: 'customer-101',
        plan: 'basic'
      },
      'sub-101',
      'trialing'
    );

    expect(subscription.id).toBe('sub-101');
    expect(subscription.customer_id).toBe('customer-101');
    expect(subscription.plan).toBe('basic');
    expect(subscription.status).toBe('trialing');

    const saved = repository.findById('sub-101');

    expect(saved).toEqual(subscription);
  });

  test('should update subscription status', () => {
    repository.create(
      {
        customer_id: 'customer-102',
        plan: 'pro'
      },
      'sub-102',
      'trialing'
    );

    repository.updateStatus('sub-102', 'active');

    const updated = repository.findById('sub-102');

    expect(updated?.status).toBe('active');
  });

  test('should return undefined for an unknown subscription', () => {
    expect(repository.findById('unknown-id')).toBeUndefined();
  });
});
