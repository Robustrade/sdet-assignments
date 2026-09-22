import { describe, expect, it } from 'vitest';
import { SubscriptionBuilder } from './builders/subscription-builder';
import { WebhookBuilder } from './builders/webhook-builder';

describe('SubscriptionBuilder', () => {
  it('builds the default subscription request', () => {
    expect(new SubscriptionBuilder().build()).toEqual({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });
  });

  it('supports a customized request without changing previous builds or defaults', () => {
    const builder = new SubscriptionBuilder();
    const original = builder.build();
    const customized = builder
      .withId('sub_002')
      .withCustomerId('cust_002')
      .withPlan('basic')
      .withPaymentMethodId('pm_002')
      .build();

    expect(customized).toEqual({
      id: 'sub_002',
      customerId: 'cust_002',
      plan: 'basic',
      paymentMethodId: 'pm_002',
    });
    expect(original).toEqual(new SubscriptionBuilder().build());

    customized.plan = 'unknown';
    expect(builder.build().plan).toBe('basic');
  });
});

describe('WebhookBuilder', () => {
  it('builds the default successful payment webhook', () => {
    expect(new WebhookBuilder().build()).toEqual({
      eventId: 'evt_001',
      type: 'payment.succeeded',
      subscriptionId: 'sub_001',
      invoiceId: 'inv_001',
      amount: 4900,
    });
  });

  it('switches payment outcome without changing previous builds or defaults', () => {
    const builder = new WebhookBuilder();
    const original = builder.build();
    const failure = builder
      .withEventId('evt_002')
      .paymentFailed()
      .forSubscription('sub_002')
      .forInvoice('inv_002')
      .withAmount(1900)
      .build();

    expect(failure).toEqual({
      eventId: 'evt_002',
      type: 'payment.failed',
      subscriptionId: 'sub_002',
      invoiceId: 'inv_002',
      amount: 1900,
    });
    expect(builder.paymentSucceeded().build().type).toBe('payment.succeeded');
    expect(failure.type).toBe('payment.failed');
    expect(original).toEqual(new WebhookBuilder().build());

    failure.amount = 0;
    expect(builder.build().amount).toBe(1900);
  });
});
