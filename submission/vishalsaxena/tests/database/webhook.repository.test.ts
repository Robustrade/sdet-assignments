
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { WebhookRepository } from '../../src/repositories/WebhookRepository';

describe('Webhook Repository', () => {
  let db: AppDatabase;
  let repository: WebhookRepository;

  beforeEach(async () => {
    db = await createDatabase();
    repository = new WebhookRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create and retrieve a webhook event', () => {
    repository.create({
      id: 'wh_001',
      providerEventId: 'evt_001',
      eventType: 'payment.succeeded',
      payload: { paymentId: 'pay_001', amount: 2999 }
    });

    const result = repository.findByProviderEventId('evt_001');

    expect(result).toBeDefined();
    expect(result?.eventType).toBe('payment.succeeded');
    expect(result?.status).toBe('received');
    expect(result?.payload).toEqual({
      paymentId: 'pay_001',
      amount: 2999
    });
  });

  it('should update webhook status to processed', () => {
    repository.create({
      id: 'wh_002',
      providerEventId: 'evt_002',
      eventType: 'payment.succeeded',
      payload: { paymentId: 'pay_002' }
    });

    repository.updateStatus('evt_002', 'processed');

    const result = repository.findByProviderEventId('evt_002');

    expect(result?.status).toBe('processed');
    expect(result?.processedAt).toBeDefined();
  });

  it('should update webhook status to failed', () => {
    repository.create({
      id: 'wh_003',
      providerEventId: 'evt_003',
      eventType: 'payment.failed',
      payload: { paymentId: 'pay_003' }
    });

    repository.updateStatus('evt_003', 'failed');

    expect(
      repository.findByProviderEventId('evt_003')?.status
    ).toBe('failed');
  });

  it('should reject duplicate provider event IDs', () => {
    repository.create({
      id: 'wh_004',
      providerEventId: 'evt_duplicate',
      eventType: 'payment.succeeded',
      payload: {}
    });

    expect(() => {
      repository.create({
        id: 'wh_005',
        providerEventId: 'evt_duplicate',
        eventType: 'payment.succeeded',
        payload: {}
      });
    }).toThrow();
  });

  it('should return undefined for an unknown event', () => {
    expect(
      repository.findByProviderEventId('evt_unknown')
    ).toBeUndefined();
  });

  it('should reject status updates for an unknown event', () => {
    expect(() => {
      repository.updateStatus('evt_unknown', 'processed');
    }).toThrow('Webhook event not found: evt_unknown');
  });
});
