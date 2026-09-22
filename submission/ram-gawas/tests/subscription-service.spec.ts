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
    vi.useRealTimers();
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

  it.each([
    { customerId: 'unknown_customer', paymentMethodId: 'pm_001', error: 'Unknown customer' },
    { customerId: '', paymentMethodId: 'pm_001', error: 'Unknown customer' },
    { customerId: 'cust_001', paymentMethodId: 'unknown_method', error: 'Invalid payment method for customer' },
    { customerId: 'cust_001', paymentMethodId: 'pm_002', error: 'Invalid payment method for customer' },
    { customerId: 'cust_001', paymentMethodId: '', error: 'Invalid payment method for customer' },
  ])('rejects customer "$customerId" and payment method "$paymentMethodId" without side effects', async ({ customerId, paymentMethodId, error }) => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId(customerId)
      .withPaymentMethodId(paymentMethodId)
      .build();

    await expect(service.createSubscription(subscription)).rejects.toThrow(error);

    expect(subscriptionRepository.findById(subscription.id)).toBeUndefined();
    expect(paymentRepository.findBySubscriptionId(subscription.id)).toHaveLength(0);
    expect(paymentProvider.calls).toHaveLength(0);
  });

  it.each([
    { customerId: 'cust_001', paymentMethodId: 'pm_test_visa_4242' },
    { customerId: 'cust_002', paymentMethodId: 'pm_002' },
  ])('accepts payment method $paymentMethodId belonging to $customerId', async ({ customerId, paymentMethodId }) => {
    const subscription = await service.createSubscription(
      new SubscriptionBuilder()
        .withCustomerId(customerId)
        .withPaymentMethodId(paymentMethodId)
        .build(),
    );

    expect(subscription).toMatchObject({ customerId, paymentMethodId, state: 'trialing' });
    expect(subscriptionRepository.findById(subscription.id)).toEqual(subscription);
    expect(paymentRepository.findBySubscriptionId(subscription.id)).toHaveLength(0);
    expect(paymentProvider.calls).toHaveLength(0);
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

  it.each([undefined, 4900])('rejects billing a canceled subscription with amount %s before charging', async (amount) => {
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const canceled = await service.cancelSubscription('sub_001');

    expect(canceled.state).toBe('canceled');

    await expect(
      service.processPayment('sub_001', amount),
    ).rejects.toThrow('Canceled subscription cannot be billed');

    expect(paymentProvider.calls).toHaveLength(0);
    expect(paymentRepository.findBySubscriptionId('sub_001')).toHaveLength(0);
    expect(subscriptionRepository.findById('sub_001')).toEqual(canceled);
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

  it('moves active subscription to past_due when recurring payment fails', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
    await service.createSubscription(new SubscriptionBuilder().build());
    paymentProvider.respondWithSuccess('txn_initial');

    const active = await service.processPayment('sub_001');
    expect(active.state).toBe('active');
    expect(subscriptionRepository.findById('sub_001')).toEqual(active);
    const initialPayments = paymentRepository.findBySubscriptionId('sub_001');
    expect(initialPayments).toEqual([
      expect.objectContaining({ status: 'success', amount: 4900, providerReference: 'txn_initial' }),
    ]);
    expect(paymentProvider.calls).toHaveLength(1);

    paymentProvider.respondWithDecline();
    const pastDue = await service.processPayment('sub_001');

    expect(pastDue.state).toBe('past_due');
    expect(subscriptionRepository.findById('sub_001')).toEqual(pastDue);
    const payments = paymentRepository.findBySubscriptionId('sub_001');
    expect(payments).toHaveLength(2);
    expect(payments).toEqual(expect.arrayContaining([
      ...initialPayments,
      expect.objectContaining({ subscriptionId: 'sub_001', status: 'failed', amount: 4900, providerReference: undefined }),
    ]));
    expect(new Set(payments.map((payment) => payment.id)).size).toBe(2);
    expect(paymentProvider.calls).toHaveLength(2);
    for (const call of paymentProvider.calls) {
      expect(call).toEqual({
        customerId: 'cust_001', paymentMethodId: 'pm_001', amount: 4900, reference: 'sub_001',
      });
    }
  });

  it('moves past_due subscription back to active when retry succeeds', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
    await service.createSubscription(new SubscriptionBuilder().withPlan('basic').build());
    paymentProvider.respondWithSuccess('txn_initial');

    const initial = await service.processPayment('sub_001');
    expect(initial.state).toBe('active');
    expect(subscriptionRepository.findById('sub_001')).toEqual(initial);
    const initialPayments = paymentRepository.findBySubscriptionId('sub_001');
    expect(initialPayments).toEqual([
      expect.objectContaining({ status: 'success', amount: 1900, providerReference: 'txn_initial' }),
    ]);
    expect(paymentProvider.calls).toHaveLength(1);

    paymentProvider.respondWithDecline();
    const pastDue = await service.processPayment('sub_001');
    expect(pastDue.state).toBe('past_due');
    expect(subscriptionRepository.findById('sub_001')).toEqual(pastDue);
    const beforeRetry = paymentRepository.findBySubscriptionId('sub_001');
    expect(beforeRetry).toHaveLength(2);
    expect(beforeRetry).toEqual(expect.arrayContaining([
      ...initialPayments,
      expect.objectContaining({ status: 'failed', amount: 1900, providerReference: undefined }),
    ]));
    expect(paymentProvider.calls).toHaveLength(2);

    paymentProvider.respondWithSuccess('txn_retry');
    const recovered = await service.processPayment('sub_001');

    expect(recovered.state).toBe('active');
    expect(subscriptionRepository.findById('sub_001')).toEqual(recovered);
    const payments = paymentRepository.findBySubscriptionId('sub_001');
    expect(payments).toHaveLength(3);
    expect(payments).toEqual(expect.arrayContaining([
      ...beforeRetry,
      expect.objectContaining({ subscriptionId: 'sub_001', status: 'success', amount: 1900, providerReference: 'txn_retry' }),
    ]));
    expect(new Set(payments.map((payment) => payment.id)).size).toBe(3);
    expect(paymentProvider.calls).toHaveLength(3);
    for (const call of paymentProvider.calls) {
      expect(call).toEqual({
        customerId: 'cust_001', paymentMethodId: 'pm_001', amount: 1900, reference: 'sub_001',
      });
    }
  });

  it('cancels past_due subscription when retries are exhausted', async () => {
    await service.createSubscription(new SubscriptionBuilder().build());
    paymentProvider.respondWithDecline();
    const pastDue = await service.processPayment('sub_001');

    expect(pastDue.state).toBe('past_due');
    expect(subscriptionRepository.findById('sub_001')).toEqual(pastDue);
    const payments = paymentRepository.findBySubscriptionId('sub_001');
    expect(payments).toEqual([
      expect.objectContaining({ status: 'failed', amount: 4900 }),
    ]);
    expect(paymentProvider.calls).toEqual([{
      customerId: 'cust_001', paymentMethodId: 'pm_001', amount: 4900, reference: 'sub_001',
    }]);

    const canceled = await service.exhaustRetries('sub_001');

    expect(canceled.state).toBe('canceled');
    expect(subscriptionRepository.findById('sub_001')).toEqual(canceled);
    expect(paymentRepository.findBySubscriptionId('sub_001')).toEqual(payments);
    expect(paymentProvider.calls).toHaveLength(1);
  });

  it.each(['trialing', 'active', 'canceled'] as const)(
    'does not exhaust retries from invalid state %s',
    async (state) => {
      await service.createSubscription(new SubscriptionBuilder().build());
      if (state === 'active') {
        await service.processPayment('sub_001');
      } else if (state === 'canceled') {
        await service.cancelSubscription('sub_001');
      }
      const subscription = subscriptionRepository.findById('sub_001');
      const payments = paymentRepository.findBySubscriptionId('sub_001');
      const calls = [...paymentProvider.calls];

      await expect(service.exhaustRetries('sub_001')).rejects.toThrow(
        `Invalid subscription transition: ${state} -> RETRIES_EXHAUSTED`,
      );

      expect(subscriptionRepository.findById('sub_001')).toEqual(subscription);
      expect(paymentRepository.findBySubscriptionId('sub_001')).toEqual(payments);
      expect(paymentProvider.calls).toEqual(calls);
    },
  );

  it('rejects exhausting retries for an unknown subscription without side effects', async () => {
    await expect(service.exhaustRetries('missing')).rejects.toThrow('Subscription not found');
    expect(subscriptionRepository.findById('missing')).toBeUndefined();
    expect(paymentRepository.findBySubscriptionId('missing')).toHaveLength(0);
    expect(paymentProvider.calls).toHaveLength(0);
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

  it.each(['active', 'canceled'] as const)(
    'records refund webhook without changing subscription state %s',
    async (state) => {
      await service.createSubscription(new SubscriptionBuilder().build());
      await service.handleWebhook(new WebhookBuilder().build());
      if (state === 'canceled') {
        await service.cancelSubscription('sub_001');
      }
      const before = subscriptionRepository.findById('sub_001');
      const originalPayments = paymentRepository.findBySubscriptionId('sub_001');
      const refund = new WebhookBuilder()
        .withEventId('evt_refund')
        .paymentRefunded()
        .build();

      const result = await service.handleWebhook(refund);

      expect(result.state).toBe(state);
      expect(result).toEqual(before);
      expect(subscriptionRepository.findById('sub_001')).toEqual(before);
      const payments = paymentRepository.findBySubscriptionId('sub_001');
      expect(payments).toHaveLength(2);
      expect(payments).toEqual(expect.arrayContaining([
        ...originalPayments,
        {
          id: 'refund_evt_refund', subscriptionId: 'sub_001', amount: 4900,
          status: 'refunded', providerReference: 'inv_001',
        },
      ]));
      expect(db.prepare(`
        SELECT event_type, processed FROM webhook_events WHERE event_id = ?
      `).get('evt_refund')).toEqual({ event_type: 'payment.refunded', processed: 1 });
      expect(paymentProvider.calls).toHaveLength(0);
    },
  );

  it('rejects a refund for an unknown subscription without side effects', async () => {
    await expect(service.handleWebhook(
      new WebhookBuilder().paymentRefunded().build(),
    )).rejects.toThrow('Subscription not found');
    expect(subscriptionRepository.findById('sub_001')).toBeUndefined();
    expect(paymentRepository.findBySubscriptionId('sub_001')).toHaveLength(0);
    expect(webhookEventRepository.exists('evt_001')).toBe(false);
    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('processes duplicate payment webhook only once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    await service.createSubscription(
      new SubscriptionBuilder().build(),
    );

    const webhook = new WebhookBuilder().paymentSucceeded().build();

    const updateState = vi.spyOn(subscriptionRepository, 'updateState');
    const firstResult =
      await service.handleWebhook(webhook);

    const firstReceipt = webhookEventRepository.findById(webhook.eventId);
    expect(firstReceipt?.deliveryCount).toBe(1);
    expect(firstReceipt?.lastReceivedAt).toBe(firstReceipt?.createdAt);
    vi.setSystemTime(new Date('2026-09-01T12:01:00.000Z'));

    const secondResult =
      await service.handleWebhook(webhook);

    expect(firstResult.state).toBe('active');
    expect(secondResult.state).toBe('active');
    expect(updateState).toHaveBeenCalledTimes(1);
    expect(webhookEventRepository.findById(webhook.eventId)).toEqual({
      ...firstReceipt,
      deliveryCount: 2,
      lastReceivedAt: '2026-09-01T12:01:00.000Z',
    });

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

  it('persists coherent timestamps and identifiers for a subscription payment webhook', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    await service.createSubscription(new SubscriptionBuilder().build());
    vi.setSystemTime(new Date('2026-09-01T12:01:00.000Z'));
    const webhook = new WebhookBuilder().build();
    await service.handleWebhook(webhook);

    const subscription = db.prepare(`
      SELECT id, state, created_at FROM subscriptions WHERE id = ?
    `).get(webhook.subscriptionId) as { id: string; state: string; created_at: string };
    const payment = db.prepare(`
      SELECT id, subscription_id, status, created_at FROM payments WHERE id = ?
    `).get(webhook.invoiceId) as { id: string; subscription_id: string; status: string; created_at: string };
    const event = webhookEventRepository.findById(webhook.eventId);

    expect(subscription).toMatchObject({ id: webhook.subscriptionId, state: 'active' });
    expect(payment).toMatchObject({ id: webhook.invoiceId, subscription_id: subscription.id, status: 'success' });
    expect(event).toMatchObject({
      eventId: webhook.eventId, subscriptionId: subscription.id,
      eventType: webhook.type, processed: true, deliveryCount: 1,
    });
    expect(event).toBeDefined();
    if (!event) throw new Error('Expected persisted webhook');
    for (const timestamp of [subscription.created_at, payment.created_at, event.createdAt, event.lastReceivedAt]) {
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    }
    expect(Date.parse(payment.created_at)).toBeGreaterThanOrEqual(Date.parse(subscription.created_at));
    expect(Date.parse(event.createdAt)).toBeGreaterThanOrEqual(Date.parse(subscription.created_at));
    expect(event.lastReceivedAt).toBe(event.createdAt);
    expect(paymentProvider.calls).toHaveLength(0);
  });

  it('rolls back all webhook writes on failure and permits successful redelivery', async () => {
    const subscription = await service.createSubscription(new SubscriptionBuilder().build());
    const webhook = new WebhookBuilder().build();
    const originalUpdate = subscriptionRepository.updateState.bind(subscriptionRepository);
    const updateState = vi.spyOn(subscriptionRepository, 'updateState').mockImplementationOnce((id, state) => {
      originalUpdate(id, state);
      throw new Error('Simulated persistence failure');
    });

    await expect(service.handleWebhook(webhook)).rejects.toThrow('Simulated persistence failure');

    expect(webhookEventRepository.findById(webhook.eventId)).toBeUndefined();
    expect(paymentRepository.findBySubscriptionId(subscription.id)).toHaveLength(0);
    expect(subscriptionRepository.findById(subscription.id)).toEqual(subscription);
    expect(paymentProvider.calls).toHaveLength(0);

    updateState.mockRestore();
    const result = await service.handleWebhook(webhook);
    expect(result.state).toBe('active');
    expect(subscriptionRepository.findById(subscription.id)).toEqual(result);
    expect(paymentRepository.findBySubscriptionId(subscription.id)).toHaveLength(1);
    expect(webhookEventRepository.findById(webhook.eventId)).toMatchObject({ processed: true, deliveryCount: 1 });
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
