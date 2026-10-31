
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../src/repository.js';
import { MockPaymentProvider } from '../src/payment-provider.js';
import { SubscriptionService } from '../src/subscription-service.js';
import { CustomerBuilder, PlanBuilder } from './builders.js';

describe('SubscriptionService', () => {
  let repository: InMemoryRepository;
  let provider: MockPaymentProvider;
  let service: SubscriptionService;

  beforeEach(() => {
    repository = new InMemoryRepository();
    provider = new MockPaymentProvider();
    service = new SubscriptionService(repository, provider);

    const customer = new CustomerBuilder()
      .withId('cust_001')
      .withEmail('test@example.com')
      .build();

    repository.addCustomer(customer);

    const basicPlan = new PlanBuilder()
      .withName('basic')
      .withPrice(1900)
      .withTrialDays(14)
      .withImmediateCharge(false)
      .build();

    repository.addPlan(basicPlan);

    const proPlan = new PlanBuilder()
      .withName('pro')
      .withPrice(4900)
      .withTrialDays(7)
      .withImmediateCharge(true)
      .build();

    repository.addPlan(proPlan);
  });

  it('creates a basic subscription as trialing', async () => {
    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('trialing');
    expect(subscription.trialEndsAt).not.toBeNull();
    expect(repository.getSubscription(subscription.id)?.status).toBe('trialing');
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects an unknown customer', async () => {
    await expect(
      service.createSubscription({
        customerId: 'unknown_customer',
        plan: 'basic',
        paymentMethodId: 'pm_test_visa_4242',
      }),
    ).rejects.toThrow('Unknown customer');

    expect(provider.calls).toHaveLength(0);
  });

  it('charges immediately for the pro plan and activates after success', async () => {
    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('active');
    expect(subscription.trialEndsAt).toBeNull();
    expect(provider.calls).toHaveLength(1);

    expect(provider.calls[0]).toMatchObject({
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amount: 4900,
      currency: 'USD',
    });

    const invoices = repository.getInvoicesForSubscription(subscription.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('paid');
  });

  it('moves pro subscription to past_due when immediate payment is declined', async () => {
    provider.setOutcome('decline');

    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('past_due');
    expect(provider.calls).toHaveLength(1);

    const invoices = repository.getInvoicesForSubscription(subscription.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('failed');
  });

  it('moves pro subscription to past_due when immediate payment times out', async () => {
    provider.setOutcome('timeout');

    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_test_visa_4242',
    });

    expect(subscription.status).toBe('past_due');
    expect(provider.calls).toHaveLength(1);

    const invoices = repository.getInvoicesForSubscription(subscription.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('failed');
  });

  it('creates a paid invoice and activates a basic subscription after successful charge', async () => {
    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const invoice = await service.chargeSubscription(subscription.id);

    expect(invoice.status).toBe('paid');
    expect(invoice.amount).toBe(1900);
    expect(repository.getInvoicesForSubscription(subscription.id)).toHaveLength(1);
    expect(repository.getSubscription(subscription.id)?.status).toBe('active');
    expect(provider.calls).toHaveLength(1);

    expect(provider.calls[0]).toMatchObject({
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amount: 1900,
      currency: 'USD',
    });
  });

  it('moves a basic subscription to past_due when payment is declined', async () => {
    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    provider.setOutcome('decline');

    const invoice = await service.chargeSubscription(subscription.id);

    expect(invoice.status).toBe('failed');
    expect(repository.getSubscription(subscription.id)?.status).toBe('past_due');
    expect(provider.calls).toHaveLength(1);
  });

  it('cancels a subscription and prevents a second cancellation', async () => {
    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const canceled = service.cancelSubscription(subscription.id);

    expect(canceled.status).toBe('canceled');

    expect(() => service.cancelSubscription(subscription.id)).toThrow(
      'Invalid subscription transition',
    );

    expect(provider.calls).toHaveLength(0);
  });

  it('changes a subscription from basic to pro without changing its status', async () => {
    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    const updated = service.changePlan(subscription.id, 'pro');

    expect(updated.plan).toBe('pro');
    expect(updated.status).toBe('trialing');
    expect(updated.trialEndsAt).toBe(subscription.trialEndsAt);
    expect(repository.getSubscription(subscription.id)?.plan).toBe('pro');
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects plan change for an unknown subscription', () => {
    expect(() => service.changePlan('unknown_sub', 'pro')).toThrow(
      'Unknown subscription',
    );
  });

  it('rejects plan change for a canceled subscription', async () => {
    const subscription = await service.createSubscription({
      customerId: 'cust_001',
      plan: 'basic',
      paymentMethodId: 'pm_test_visa_4242',
    });

    service.cancelSubscription(subscription.id);

    expect(() => service.changePlan(subscription.id, 'pro')).toThrow(
      'Cannot change plan for a canceled subscription',
    );
  });
});
