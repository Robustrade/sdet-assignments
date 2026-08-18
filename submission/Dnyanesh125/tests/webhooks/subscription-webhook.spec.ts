import { test, expect } from '@playwright/test';
import { FakePaymentProvider } from '../../src/providers/fake-payment-provider';
import { InMemoryBillingRepository } from '../../src/repositories/in-memory-billing-repository';
import { SubscriptionService } from '../../src/domain/subscription-service';

test.describe('Subscription Payment Webhooks', () => {
  test('should activate a trialing subscription when payment succeeds', async () => {
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

    const result = await service.handlePaymentSucceeded({
      eventId: 'evt_001',
      subscriptionId: subscription.id,
      invoiceId: 'inv_001',
      amountCents: 4900,
      currency: 'USD',
      providerPaymentId: 'pay_001',
    });

    expect(result.status).toBe('active');

    expect(
      repository.findSubscription(subscription.id)?.status,
    ).toBe('active');

    expect(
      repository.findInvoice('inv_001'),
    ).toEqual({
      id: 'inv_001',
      subscriptionId: subscription.id,
      amountCents: 4900,
      currency: 'USD',
      status: 'paid',
      providerPaymentId: 'pay_001',
    });
  });
    test('should ignore duplicate webhook', async () => {
    const repository = new InMemoryBillingRepository();
    const paymentProvider = new FakePaymentProvider();
    const service = new SubscriptionService(repository, paymentProvider);

    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const event = {
      eventId: 'evt_duplicate',
      subscriptionId: subscription.id,
      invoiceId: 'inv_duplicate',
      amountCents: 4900,
      currency: 'USD',
      providerPaymentId: 'pay_duplicate',
    };

    await service.handlePaymentSucceeded(event);
    await service.handlePaymentSucceeded(event);

    expect(repository.findInvoice('inv_duplicate')).toBeDefined();
  });

});
