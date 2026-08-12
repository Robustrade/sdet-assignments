import { InMemorySubscriptionRepository } from '../../src/infrastructure/persistence/in-memory-subscription-repository';
import type { Subscription } from '../../src/domain/models/subscription';

describe('InMemorySubscriptionRepository', () => {
  const createSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
    id: 'sub_001',
    customerId: 'cust_001',
    plan: 'pro',
    status: 'trialing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('findById() returns undefined when the subscription does not exist', () => {
    const repository = new InMemorySubscriptionRepository();

    expect(repository.findById('missing-sub')).toBeUndefined();
  });

  it('save() persists a subscription and findById() returns the same subscription', () => {
    const repository = new InMemorySubscriptionRepository();
    const subscription = createSubscription();

    repository.save(subscription);

    expect(repository.findById(subscription.id)).toEqual(subscription);
  });

  it('saving two different subscriptions allows both to be retrieved independently', () => {
    const repository = new InMemorySubscriptionRepository();
    const sub1 = createSubscription({ id: 'sub_001', customerId: 'cust_001' });
    const sub2 = createSubscription({ id: 'sub_002', customerId: 'cust_002', plan: 'basic' });

    repository.save(sub1);
    repository.save(sub2);

    expect(repository.findById(sub1.id)).toEqual(sub1);
    expect(repository.findById(sub2.id)).toEqual(sub2);
  });

  it('saving a subscription with the same ID replaces the previously stored subscription', () => {
    const repository = new InMemorySubscriptionRepository();
    const original = createSubscription({ id: 'sub_001', status: 'trialing' });
    const replacement = createSubscription({
      id: 'sub_001',
      customerId: 'cust_updated',
      plan: 'basic',
      status: 'active',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    repository.save(original);
    repository.save(replacement);

    expect(repository.findById('sub_001')).toEqual(replacement);
  });

  it('delete() removes an existing subscription', () => {
    const repository = new InMemorySubscriptionRepository();
    const subscription = createSubscription();

    repository.save(subscription);
    repository.delete(subscription.id);

    expect(repository.findById(subscription.id)).toBeUndefined();
  });

  it('deleting a non-existent subscription does not throw', () => {
    const repository = new InMemorySubscriptionRepository();

    expect(() => repository.delete('missing-sub')).not.toThrow();
  });

  it('after deleting a subscription, findById() returns undefined', () => {
    const repository = new InMemorySubscriptionRepository();
    const subscription = createSubscription();

    repository.save(subscription);
    repository.delete(subscription.id);

    expect(repository.findById(subscription.id)).toBeUndefined();
  });
});
