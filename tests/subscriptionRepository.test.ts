import { SubscriptionRepository } from '../src/repositories/subscriptionRepository';

describe('SubscriptionRepository', () => {
  let repository: SubscriptionRepository;

  const subscription = {
    id: 'sub_1',
    customerId: 'customer_1',
    plan: 'basic',
    status: 'trialing',
    priceCents: 99900,
    trialDays: 7,
    retryCount: 0,
  };

  beforeEach(() => {
    repository = new SubscriptionRepository();
  });

  test('should save a subscription', () => {
    repository.save(subscription);

    expect(repository.findById('sub_1')).toEqual(subscription);
  });

  test('should return undefined for unknown subscription', () => {
    expect(repository.findById('unknown')).toBeUndefined();
  });

  test('should return all subscriptions', () => {
    repository.save(subscription);

    expect(repository.findAll()).toEqual([subscription]);
  });

  test('should delete a subscription', () => {
    repository.save(subscription);

    expect(repository.delete('sub_1')).toBe(true);
    expect(repository.findById('sub_1')).toBeUndefined();
  });

  test('should return false when deleting unknown subscription', () => {
    expect(repository.delete('unknown')).toBe(false);
  });
});