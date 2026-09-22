import { beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/database';
import { SubscriptionRepository } from '../src/repositories/subscription-repository';
import { PaymentRepository } from '../src/repositories/payment-repository';
import { WebhookEventRepository } from '../src/repositories/webhook-event-repository';
import { SubscriptionService } from '../src/subscription-service';
import { MockPaymentProvider } from './mocks/mock-payment-provider';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let subscriptionRepository: SubscriptionRepository;
  let paymentRepository: PaymentRepository;
  let webhookEventRepository: WebhookEventRepository;
  let paymentProvider: MockPaymentProvider;
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase();

    subscriptionRepository = new SubscriptionRepository(db);
    paymentRepository = new PaymentRepository(db);
    webhookEventRepository = new WebhookEventRepository(db);
    paymentProvider = new MockPaymentProvider();

    service = new SubscriptionService(
      subscriptionRepository,
      paymentRepository,
      webhookEventRepository,
      paymentProvider,
    );
  });

  it('creates a trialing subscription', async () => {
    const subscription = await service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });

    expect(subscription.state).toBe('trialing');

    const persisted =
      subscriptionRepository.findById('sub_001');

    expect(persisted?.state).toBe('trialing');
  });

  it('moves subscription to active after successful payment', async () => {
    await service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });

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
    await service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });

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
    await service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });

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
    await service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });

    const result = await service.handleWebhook({
      eventId: 'evt_001',
      type: 'payment.succeeded',
      subscriptionId: 'sub_001',
      invoiceId: 'inv_001',
      amount: 4900,
    });

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
    await service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });

    const result = await service.handleWebhook({
      eventId: 'evt_001',
      type: 'payment.failed',
      subscriptionId: 'sub_001',
      invoiceId: 'inv_001',
      amount: 4900,
    });

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
    await service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });

    const webhook = {
      eventId: 'evt_001',
      type: 'payment.succeeded' as const,
      subscriptionId: 'sub_001',
      invoiceId: 'inv_001',
      amount: 4900,
    };

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
    const subscription = await service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      paymentMethodId: 'pm_001',
    });

    expect(subscription.state).toBe('trialing');

    const success = await service.handleWebhook({
      eventId: 'evt_success',
      type: 'payment.succeeded',
      subscriptionId: 'sub_001',
      invoiceId: 'inv_001',
      amount: 4900,
    });

    expect(success.state).toBe('active');

    const failure = await service.handleWebhook({
      eventId: 'evt_failure',
      type: 'payment.failed',
      subscriptionId: 'sub_001',
      invoiceId: 'inv_001',
      amount: 4900,
    });

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
  await service.createSubscription({
    id: 'sub_001',
    customerId: 'cust_001',
    plan: 'pro',
    paymentMethodId: 'pm_001',
  });

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
  await service.createSubscription({
    id: 'sub_001',
    customerId: 'cust_001',
    plan: 'pro',
    paymentMethodId: 'pm_001',
  });

  await service.cancelSubscription('sub_001');

  const result = await service.handleWebhook({
    eventId: 'evt_001',
    type: 'payment.succeeded',
    subscriptionId: 'sub_001',
    invoiceId: 'inv_001',
    amount: 4900,
  });

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
