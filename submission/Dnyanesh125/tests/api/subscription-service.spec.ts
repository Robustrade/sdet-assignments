import { test, expect } from '@playwright/test';
import { FakePaymentProvider } from '../../src/providers/fake-payment-provider';
import { InMemoryBillingRepository } from '../../src/repositories/in-memory-billing-repository';
import { SubscriptionService } from '../../src/domain/subscription-service';

test.describe('Subscription Service', () => {
  test('should create a pro subscription in trialing state without charging immediately', async () => {
    const repository = new InMemoryBillingRepository();
    const paymentProvider = new FakePaymentProvider();

    const service = new SubscriptionService(
      repository,
      paymentProvider,
    );

    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('trialing');
    expect(subscription.plan).toBe('pro');
    expect(subscription.customerId).toBe('cust_001');

    expect(paymentProvider.getCallCount()).toBe(0);

    expect(
      repository.findSubscription(subscription.id),
    ).toEqual(subscription);
  });
});
