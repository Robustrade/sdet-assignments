
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { SqliteDatabase } from '../../src/database/Database.js';
import { initializeSchema } from '../../src/database/DatabaseSchema.js';
import { DatabaseSeeder } from '../../src/database/DatabaseSeeder.js';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository.js';
import { WebhookRepository } from '../../src/repositories/WebhookRepository.js';

describe('WebhookRepository', () => {
  let database: SqliteDatabase;
  let webhookRepository: WebhookRepository;

  beforeEach(() => {
    database = new SqliteDatabase();
    initializeSchema(database.connection);

    const seeder = new DatabaseSeeder(database.connection);
    seeder.seed();

    const subscriptionRepository = new SubscriptionRepository(
      database.connection
    );

    subscriptionRepository.create({
      id: 'sub_001',
      customer_id: 'cust_001',
      plan_id: 'plan_basic',
      payment_method_id: 'pm_test_visa_4242',
      status: 'trialing'
    });

    webhookRepository = new WebhookRepository(
      database.connection
    );
  });

  afterEach(() => {
    database.close();
  });

  it('should create a webhook event', () => {
    const event = webhookRepository.create({
      event_id: 'evt_001',
      event_type: 'payment.succeeded',
      subscription_id: 'sub_001',
      payload_json: '{"amount":1900}'
    });

    expect(event.event_id).toBe('evt_001');
    expect(event.event_type).toBe('payment.succeeded');
    expect(event.processing_status).toBe('received');
  });

  it('should find an event by ID', () => {
    webhookRepository.create({
      event_id: 'evt_001',
      event_type: 'payment.succeeded',
      subscription_id: 'sub_001',
      payload_json: '{}'
    });

    const event = webhookRepository.findById('evt_001');

    expect(event).not.toBeNull();
    expect(event?.event_id).toBe('evt_001');
  });

  it('should return null for an unknown event', () => {
    expect(webhookRepository.findById('unknown')).toBeNull();
  });

  it('should identify duplicate event IDs', () => {
    webhookRepository.create({
      event_id: 'evt_001',
      event_type: 'payment.succeeded',
      subscription_id: 'sub_001',
      payload_json: '{}'
    });

    expect(webhookRepository.exists('evt_001')).toBe(true);
    expect(webhookRepository.exists('evt_999')).toBe(false);
  });

  it('should reject duplicate event insertion', () => {
    const event = {
      event_id: 'evt_001',
      event_type: 'payment.succeeded',
      subscription_id: 'sub_001',
      payload_json: '{}'
    };

    webhookRepository.create(event);

    expect(() => webhookRepository.create(event)).toThrow();
  });

  it('should update event processing status', () => {
    webhookRepository.create({
      event_id: 'evt_001',
      event_type: 'payment.succeeded',
      subscription_id: 'sub_001',
      payload_json: '{}'
    });

    const updated = webhookRepository.updateProcessingStatus(
      'evt_001',
      'processed'
    );

    expect(updated.processing_status).toBe('processed');
    expect(updated.processed_at).not.toBeNull();
  });

  it('should find events by subscription ID', () => {
    webhookRepository.create({
      event_id: 'evt_001',
      event_type: 'payment.succeeded',
      subscription_id: 'sub_001',
      payload_json: '{}'
    });

    webhookRepository.create({
      event_id: 'evt_002',
      event_type: 'payment.failed',
      subscription_id: 'sub_001',
      payload_json: '{}'
    });

    const events = webhookRepository.findBySubscriptionId('sub_001');

    expect(events).toHaveLength(2);
  });

  it('should throw when updating an unknown event', () => {
    expect(() => {
      webhookRepository.updateProcessingStatus(
        'unknown',
        'processed'
      );
    }).toThrow('Webhook event not found: unknown');
  });
});
