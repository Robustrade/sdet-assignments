import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionBuilder } from './builders/subscription-builder';
import { WebhookBuilder } from './builders/webhook-builder';
import { createTestEnvironment, type TestEnvironment } from './fixtures/test-environment';

describe('SubscriptionService', () => {
  let db: TestEnvironment['db'];
  let service: TestEnvironment['service'];
  let subscriptionRepository: TestEnvironment['subscriptionRepository'];
  let paymentRepository: TestEnvironment['paymentRepository'];
  let webhookEventRepository: TestEnvironment['webhookRepository'];
  let paymentProvider: TestEnvironment['paymentProvider'];

  beforeEach(() => {
    ({
      db,
      service,
      subscriptionRepository,
      paymentRepository,
      webhookRepository: webhookEventRepository,
      paymentProvider,
    } = createTestEnvironment());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it.each([
    { plan: 'basic', price: 1900, trialEndsAt: '2026-10-02T12:00:00.000Z' },
    { plan: 'pro', price: 4900, trialEndsAt: '2026-10-09T12:00:00.000Z' },
  ])('applies $plan trial length and payment price', async ({ plan, price, trialEndsAt }) => {
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-09-25T12:00:00.000Z'),
    );

    const subscription = await service.createSubscription(
      new SubscriptionBuilder().withPlan(plan).build(),
    );

    expect(subscription.state).toBe('trialing');
    expect(subscription.trialEndsAt).toBe(trialEndsAt);
    expect(subscriptionRepository.findById('sub_001')).toEqual(subscription);
    expect(paymentProvider.calls).toHaveLength(0);

    const paid = await service.processPayment('sub_001');

    expect(paid.state).toBe('active');
    expect(paid.trialEndsAt).toBe(trialEndsAt);
    expect(paymentProvider.calls).toEqual([{
      customerId: 'cust_001',
      paymentMethodId: 'pm_001',
      amount: price,
      reference: 'sub_001',
    }]);
    expect(paymentRepository.findBySubscriptionId('sub_001')).toEqual([
      expect.objectContaining({ amount: price, status: 'success' }),
    ]);
    expect(subscriptionRepository.findById('sub_001')).toEqual(paid);
  });

  it('preserves an explicitly supplied payment amount', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().withPlan('basic').build(),
    );

    await service.processPayment('sub_001', 1000);

    expect(paymentProvider.calls).toHaveLength(1);
    expect(paymentProvider.calls[0]?.amount).toBe(1000);
    expect(paymentRepository.findBySubscriptionId('sub_001')).toEqual([
      expect.objectContaining({ amount: 1000, status: 'success' }),
    ]);
  });

  it('creates a trialing subscription', async () => {
    const subscription = await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    expect(subscription.state).toBe('trialing');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('trialing');
  });

  it('rejects an unsupported plan before saving a subscription', async () => {
    await expect(service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'unknown',
      paymentMethodId: 'pm_001',
    })).rejects.toThrow('Invalid plan');

    expect(subscriptionRepository.findById('sub_001')).toBeUndefined();
    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('moves subscription to active after successful payment', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    paymentProvider.respondWithSuccess('txn_001');

    const subscription =
      await service.processPayment('sub_001', 4900);

    expect(subscription.state).toBe('active');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('active');

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('success');
    expect(payments[0]?.amount).toBe(4900);
    expect(payments[0]?.providerReference).toBe('txn_001');

    expect(paymentProvider.calls).toHaveLength(1);

    expect(paymentProvider.calls[0]).toEqual({
      customerId: 'cust_001',
      paymentMethodId: 'pm_001',
      amount: 4900,
      reference: 'sub_001',
    });
  });

  it('moves subscription to past_due after declined payment', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    paymentProvider.respondWithDecline('card_declined');

    const subscription =
      await service.processPayment('sub_001', 4900);

    expect(subscription.state).toBe('past_due');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('past_due');

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('failed');
    expect(payments[0]?.amount).toBe(4900);

    expect(paymentProvider.calls).toHaveLength(1);

    expect(paymentProvider.calls[0]).toMatchObject({
      customerId: 'cust_001',
      paymentMethodId: 'pm_001',
      amount: 4900,
      reference: 'sub_001',
    });
  });

  it('does not create a successful payment when provider times out', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    paymentProvider.respondWithTimeout();

    await expect(
      service.processPayment('sub_001', 4900),
    ).rejects.toThrow('Payment provider timeout');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('trialing');

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(0);

    expect(paymentProvider.calls).toHaveLength(1);
  });

  it('processes a successful payment webhook and moves subscription to active', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const result = await service.handleWebhook(
      new WebhookBuilder().paymentSucceeded().build(),
    );

    expect(result.state).toBe('active');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('active');

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('success');
    expect(payments[0]?.amount).toBe(4900);

    expect(
      webhookEventRepository.exists('evt_001'),
    ).toBe(true);

    // Incoming webhook should not trigger a new provider charge.
    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('processes a failed payment webhook and moves subscription to past_due', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const result = await service.handleWebhook(
      new WebhookBuilder().paymentFailed().build(),
    );

    expect(result.state).toBe('past_due');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('past_due');

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('failed');

    expect(
      webhookEventRepository.exists('evt_001'),
    ).toBe(true);

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('processes duplicate payment webhook only once', async () => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const webhook = new WebhookBuilder().paymentSucceeded().build();

    const firstResult =
      await service.handleWebhook(webhook);

    const secondResult =
      await service.handleWebhook(webhook);

    expect(firstResult.state).toBe('active');
    expect(secondResult.state).toBe('active');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('active');

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(1);

    expect(
      webhookEventRepository.exists('evt_001'),
    ).toBe(true);

    // Replayed webhook must not trigger a provider charge.
    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('does not regress active subscription when stale failure arrives after success for same invoice', async () => {
    const subscription = await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    expect(subscription.state).toBe('trialing');

    const success = await service.handleWebhook(
      new WebhookBuilder()
        .withEventId('evt_success')
        .paymentSucceeded()
        .build(),
    );

    expect(success.state).toBe('active');

    const failure = await service.handleWebhook(
      new WebhookBuilder()
        .withEventId('evt_failure')
        .paymentFailed()
        .build(),
    );

    expect(failure.state).toBe('active');
    expect(
      subscriptionRepository.findById('sub_001')?.state,
    ).toBe('active');

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      id: 'inv_001',
      status: 'success',
      amount: 4900,
    });

    expect(webhookEventRepository.exists('evt_success')).toBe(true);
    expect(webhookEventRepository.exists('evt_failure')).toBe(true);
    expect(db.prepare(`
      SELECT event_id, processed
      FROM webhook_events
      ORDER BY event_id
    `).all()).toEqual([
      { event_id: 'evt_failure', processed: 0 },
      { event_id: 'evt_success', processed: 1 },
    ]);

    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('cancels an active subscription', async () => {
  await service.createSubscription(
    new SubscriptionBuilder().build(),
  );

  paymentProvider.respondWithSuccess('txn_001');

  await service.processPayment('sub_001', 4900);

  const canceled =
    await service.cancelSubscription('sub_001');

  expect(canceled.state).toBe('canceled');

  const persisted =
    subscriptionRepository.findById('sub_001');

  expect(persisted?.state).toBe('canceled');
});

it('does not reactivate a canceled subscription from a success webhook', async () => {
  await service.createSubscription(
    new SubscriptionBuilder().build(),
  );

  await service.cancelSubscription('sub_001');

  const result = await service.handleWebhook(
    new WebhookBuilder().paymentSucceeded().build(),
  );

  expect(result.state).toBe('canceled');

  const persisted =
    subscriptionRepository.findById('sub_001');

  expect(persisted?.state).toBe('canceled');

  const payments =
    paymentRepository.findBySubscriptionId('sub_001');

  expect(payments).toHaveLength(0);

  expect(
    webhookEventRepository.exists('evt_001'),
  ).toBe(true);
});
});
