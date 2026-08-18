import { test, expect } from '@playwright/test';
import { InMemoryBillingRepository } from '../../src/repositories/in-memory-billing-repository';
import { SubscriptionBuilder } from '../../src/builders/subscription-builder';

test.describe('Billing Repository', () => {
  test('should persist and retrieve a subscription', () => {
    const repository = new InMemoryBillingRepository();

    const subscription = new SubscriptionBuilder()
      .withId('sub_001')
      .forCustomer('cust_001')
      .withPlan('pro')
      .build();

    repository.saveSubscription(subscription);

    expect(repository.findSubscription('sub_001')).toEqual(subscription);
  });

  test('should persist and retrieve an invoice', () => {
    const repository = new InMemoryBillingRepository();

    const invoice = {
      id: 'inv_001',
      subscriptionId: 'sub_001',
      amountCents: 4900,
      currency: 'USD',
      status: 'paid' as const,
      providerPaymentId: 'pay_001',
    };

    repository.saveInvoice(invoice);

    expect(repository.findInvoice('inv_001')).toEqual(invoice);
  });

  test('should persist webhook events by event id', () => {
    const repository = new InMemoryBillingRepository();

    const event = {
      eventId: 'evt_001',
      subscriptionId: 'sub_001',
      type: 'payment.succeeded',
      processed: true,
    };

    repository.saveWebhookEvent(event);

    expect(repository.findWebhookEvent('evt_001')).toEqual(event);
    expect(repository.getWebhookEventCount()).toBe(1);
  });

  test('should not create duplicate webhook event records for the same event id', () => {
    const repository = new InMemoryBillingRepository();

    const event = {
      eventId: 'evt_duplicate',
      subscriptionId: 'sub_001',
      type: 'payment.succeeded',
      processed: true,
    };

    repository.saveWebhookEvent(event);
    repository.saveWebhookEvent(event);

    expect(repository.getWebhookEventCount()).toBe(1);
  });
});
