
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../src/repository.js';
import { MockPaymentProvider } from '../src/payment-provider.js';
import { SubscriptionService } from '../src/subscription-service.js';

describe('SubscriptionService', () => {
  let repository: InMemoryRepository;
  let provider: MockPaymentProvider;
  let service: SubscriptionService;

  beforeEach(() => {
    repository = new InMemoryRepository();
    provider = new MockPaymentProvider();
    service = new SubscriptionService(repository, provider);

    repository.addCustomer({
      id: 'cust_001',
      email: 'customer@example.com',
    });

    repository.addPlan({
      name: 'basic',
      price: 1900,
      currency: 'USD',
      trialDays: 14,
      chargeImmediately: false,
    });

    repository.addPlan({
      name: 'pro',
      price: 4900,
      currency: 'USD',
      trialDays: 7,
      chargeImmediately: true,
    });
  });

  it('creates a trialing subscription for the basic plan', () => {
    const subscription = service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('trialing');
    expect(subscription.trialEndsAt).not.toBeNull();
    expect(repository.getSubscription(subscription.id)?.status).toBe('trialing');
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects an unknown customer without calling the provider', () => {
    expect(() =>
      service.createSubscription({
        customerId: 'cust_unknown',
        plan: 'basic',
        paymentMethodId: 'pm_test_visa_4242',
      }),
    ).toThrow('Unknown customer');

    expect(provider.calls).toHaveLength(0);
  });

  it('creates a pro subscription as active per plan configuration', () => {
    const subscription = service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('active');
    expect(subscription.trialEndsAt).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  it('records a successful charge and calls the provider with correct details', async () => {
    const subscription = service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const invoice = await service.chargeSubscription(subscription.id);

    expect(invoice.status).toBe('paid');
    expect(invoice.amount).toBe(1900);
    expect(repository.getInvoicesForSubscription(subscription.id)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amount: 1900,
      currency: 'USD',
      idempotencyKey: invoice.id,
    });
    expect(service.getSubscription(subscription.id)?.status).toBe('active');
  });

  it('moves a trialing subscription to past_due after a declined charge', async () => {
    const subscription = service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    provider.setOutcome('decline');

    const invoice = await service.chargeSubscription(subscription.id);

    expect(invoice.status).toBe('failed');
    expect(service.getSubscription(subscription.id)?.status).toBe('past_due');
    expect(repository.getInvoicesForSubscription(subscription.id)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('cancels a subscription and rejects cancellation a second time', () => {
    const subscription = service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(service.cancelSubscription(subscription.id).status).toBe('canceled');
    expect(() => service.cancelSubscription(subscription.id)).toThrow(
      'Invalid subscription transition',
    );
    expect(provider.calls).toHaveLength(0);
  });
});
