import { InMemorySubscriptionRepository } from '../../src/infrastructure/persistence/in-memory-subscription-repository';
import { MockPaymentProvider } from '../../src/infrastructure/payment/mock-payment-provider';
import { DefaultSubscriptionService } from '../../src/application/services/subscription-service';

describe('DefaultSubscriptionService', () => {
  it('creates a trialing subscription without calling the payment provider', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.customerId).toBe('cust_001');
    expect(subscription.plan).toBe('basic');
    expect(subscription.status).toBe('trialing');
    expect(subscription.id).toMatch(/^sub_/);
    expect(subscription.createdAt).toBeTruthy();
    expect(subscription.updatedAt).toBeTruthy();
    expect(new Date(subscription.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(subscription.createdAt).getTime(),
    );
    expect(repository.findById(subscription.id)).toEqual(subscription);
    expect(paymentProvider.callCount).toBe(0);
  });

  it('returns an existing subscription through getSubscription()', () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const subscription = {
      id: 'sub_123',
      customerId: 'cust_001',
      plan: 'basic' as const,
      status: 'trialing' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    repository.save(subscription);

    expect(service.getSubscription('sub_123')).toEqual(subscription);
  });

  it('throws when getSubscription() cannot find a subscription', () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    expect(() => service.getSubscription('missing-sub')).toThrow('Subscription not found');
  });

  it('creates an active subscription for immediate-charge plan when payment succeeds', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('active');
    expect(paymentProvider.callCount).toBe(1);
    expect(paymentProvider.getCalls()).toEqual([
      {
        customerId: 'cust_001',
        amount: 4900,
        currency: 'USD',
        paymentMethodId: 'pm_test_visa_4242',
        subscriptionId: subscription.id,
      },
    ]);
    expect(repository.findById(subscription.id)).toEqual(subscription);
  });

  it('does not activate a subscription when payment is declined', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    paymentProvider.configureOutcome('decline');
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('past_due');
    expect(paymentProvider.callCount).toBe(1);
    expect(paymentProvider.getCalls()).toEqual([
      {
        customerId: 'cust_001',
        amount: 4900,
        currency: 'USD',
        paymentMethodId: 'pm_test_visa_4242',
        subscriptionId: subscription.id,
      },
    ]);
    expect(repository.findById(subscription.id)?.status).toBe('past_due');
  });

  it('does not activate a subscription when payment times out', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    paymentProvider.configureOutcome('timeout');
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('past_due');
    expect(paymentProvider.callCount).toBe(1);
    expect(paymentProvider.getCalls()).toEqual([
      {
        customerId: 'cust_001',
        amount: 4900,
        currency: 'USD',
        paymentMethodId: 'pm_test_visa_4242',
        subscriptionId: subscription.id,
      },
    ]);
    expect(repository.findById(subscription.id)?.status).toBe('past_due');
  });

  it('cancels a trialing subscription and does not charge again', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const created = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const originalUpdatedAt = created.updatedAt;
    const canceled = await service.cancelSubscription(created.id);

    expect(canceled.status).toBe('canceled');
    expect(repository.findById(created.id)?.status).toBe('canceled');
    expect(paymentProvider.callCount).toBe(0);
    expect(canceled.updatedAt).toBeTruthy();
    expect(new Date(canceled.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it('cancels an active subscription and keeps payment provider calls unchanged', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const created = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const callCountBeforeCancel = paymentProvider.callCount;
    const canceled = await service.cancelSubscription(created.id);

    expect(canceled.status).toBe('canceled');
    expect(repository.findById(created.id)?.status).toBe('canceled');
    expect(paymentProvider.callCount).toBe(callCountBeforeCancel);
  });

  it('cancels a past_due subscription and keeps payment provider calls unchanged', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    paymentProvider.configureOutcome('decline');
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const created = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const callCountBeforeCancel = paymentProvider.callCount;
    const canceled = await service.cancelSubscription(created.id);

    expect(canceled.status).toBe('canceled');
    expect(repository.findById(created.id)?.status).toBe('canceled');
    expect(paymentProvider.callCount).toBe(callCountBeforeCancel);
  });

  it('fails when canceling a non-existent subscription', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    await expect(service.cancelSubscription('missing-sub')).rejects.toThrow('Subscription not found');
  });

  it('fails when canceling an already canceled subscription', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    const created = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    await service.cancelSubscription(created.id);

    await expect(service.cancelSubscription(created.id)).rejects.toThrow('already canceled');
  });

  it('rejects unsupported plans without persisting or charging', async () => {
    const repository = new InMemorySubscriptionRepository();
    const paymentProvider = new MockPaymentProvider();
    const service = new DefaultSubscriptionService(repository, paymentProvider);

    await expect(
      service.createSubscription({
        customerId: 'cust_001',
        plan: 'enterprise',
        paymentMethodId: 'pm_test_visa_4242',
      }),
    ).rejects.toThrow('Unknown plan');

    expect((repository as any).subscriptions.size).toBe(0);
    expect(paymentProvider.callCount).toBe(0);
  });
});
