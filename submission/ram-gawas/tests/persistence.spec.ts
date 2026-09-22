import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database';
import { PaymentRepository } from '../src/repositories/payment-repository';
import { WebhookEventRepository } from '../src/repositories/webhook-event-repository';

describe('Persistence repositories', () => {
  let paymentRepository: PaymentRepository;
  let webhookRepository: WebhookEventRepository;

  beforeEach(() => {
    const db = createDatabase();

    paymentRepository = new PaymentRepository(db);
    webhookRepository = new WebhookEventRepository(db);
  });

  it('stores payment records', () => {
    paymentRepository.save({
      id: 'pay_001',
      subscriptionId: 'sub_001',
      amount: 4900,
      status: 'success',
      providerReference: 'txn_001',
    });

    const payments =
      paymentRepository.findBySubscriptionId('sub_001');

    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('success');
    expect(payments[0]?.amount).toBe(4900);
  });

  it('tracks processed webhook events', () => {
    webhookRepository.save({
      eventId: 'evt_001',
      subscriptionId: 'sub_001',
      eventType: 'payment.succeeded',
      processed: true,
    });

    expect(
      webhookRepository.exists('evt_001'),
    ).toBe(true);
  });
});