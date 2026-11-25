
import { describe, it, expect } from 'vitest';

import { SubscriptionBuilder } from './SubscriptionBuilder.js';
import { WebhookBuilder } from './WebhookBuilder.js';

describe('SubscriptionBuilder', () => {
  it('should create subscription data with default values', () => {
    const subscription = new SubscriptionBuilder().build();

    expect(subscription).toEqual({
      id: 'sub_test_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_001'
    });
  });

  it('should allow customizing subscription data', () => {
    const subscription = new SubscriptionBuilder()
      .withId('sub_custom_001')
      .withCustomerId('cust_002')
      .withPlanId('plan_pro')
      .withPaymentMethodId('pm_custom_001')
      .build();

    expect(subscription.id).toBe('sub_custom_001');
    expect(subscription.customerId).toBe('cust_002');
    expect(subscription.planId).toBe('plan_pro');
    expect(subscription.paymentMethodId).toBe('pm_custom_001');
  });

  it('should return independent copies when build is called', () => {
    const builder = new SubscriptionBuilder();

    const first = builder.build();
    const second = builder.build();

    first.id = 'changed';

    expect(second.id).toBe('sub_test_001');
  });
});

describe('WebhookBuilder', () => {
  it('should create a successful payment webhook by default', () => {
    const webhook = new WebhookBuilder().build();

    expect(webhook.event_type).toBe('payment.succeeded');
    expect(webhook.event_id).toBeDefined();
    expect(webhook.data.invoice_id).toBe('inv_test_001');

    if (webhook.event_type === 'payment.succeeded') {
      expect(webhook.data.provider_reference).toBe('provider_ref_001');
    }
  });

  it('should create a failed payment webhook', () => {
    const webhook = new WebhookBuilder()
      .asFailed('Insufficient funds')
      .build();

    expect(webhook.event_type).toBe('payment.failed');

    if (webhook.event_type === 'payment.failed') {
      expect(webhook.data.failure_reason).toBe('Insufficient funds');
    }
  });

  it('should allow customizing webhook identifiers', () => {
    const webhook = new WebhookBuilder()
      .withEventId('evt_custom_001')
      .withInvoiceId('inv_custom_001')
      .withSubscriptionId('sub_custom_001')
      .build();

    expect(webhook.event_id).toBe('evt_custom_001');
    expect(webhook.data.invoice_id).toBe('inv_custom_001');
    expect(webhook.data.subscription_id).toBe('sub_custom_001');
  });
});
