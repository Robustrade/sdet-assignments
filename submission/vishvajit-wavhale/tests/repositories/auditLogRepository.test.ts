
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
import { AuditLogRepository } from '../../src/repositories/AuditLogRepository.js';

describe('AuditLogRepository', () => {
  let database: SqliteDatabase;
  let auditLogRepository: AuditLogRepository;

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

    auditLogRepository = new AuditLogRepository(
      database.connection
    );
  });

  afterEach(() => {
    database.close();
  });

  it('should create an audit log', () => {
    const log = auditLogRepository.create({
      subscription_id: 'sub_001',
      event_type: 'subscription.created',
      previous_state: null,
      new_state: 'trialing',
      source: 'api'
    });

    expect(log.id).toBeGreaterThan(0);
    expect(log.subscription_id).toBe('sub_001');
    expect(log.event_type).toBe('subscription.created');
    expect(log.new_state).toBe('trialing');
  });

  it('should store metadata as JSON', () => {
    const log = auditLogRepository.create({
      subscription_id: 'sub_001',
      event_type: 'payment.failed',
      previous_state: 'active',
      new_state: 'past_due',
      source: 'webhook',
      metadata: {
        failureReason: 'Insufficient funds',
        retryAttempt: 2
      }
    });

    expect(log.metadata_json).not.toBeNull();

    const metadata = JSON.parse(log.metadata_json!);

    expect(metadata.failureReason).toBe('Insufficient funds');
    expect(metadata.retryAttempt).toBe(2);
  });

  it('should find an audit log by ID', () => {
    const created = auditLogRepository.create({
      subscription_id: 'sub_001',
      event_type: 'subscription.created',
      new_state: 'trialing',
      source: 'api'
    });

    const log = auditLogRepository.findById(created.id);

    expect(log).not.toBeNull();
    expect(log?.event_type).toBe('subscription.created');
  });

  it('should return null for an unknown audit log', () => {
    const log = auditLogRepository.findById(999);

    expect(log).toBeNull();
  });

  it('should retrieve logs for a subscription in insertion order', () => {
    auditLogRepository.create({
      subscription_id: 'sub_001',
      event_type: 'subscription.created',
      new_state: 'trialing',
      source: 'api'
    });

    auditLogRepository.create({
      subscription_id: 'sub_001',
      event_type: 'payment.succeeded',
      previous_state: 'trialing',
      new_state: 'active',
      source: 'webhook'
    });

    const logs = auditLogRepository.findBySubscriptionId('sub_001');

    expect(logs).toHaveLength(2);
    expect(logs[0].new_state).toBe('trialing');
    expect(logs[1].new_state).toBe('active');
  });

  it('should retrieve all audit logs', () => {
    auditLogRepository.create({
      subscription_id: 'sub_001',
      event_type: 'subscription.created',
      new_state: 'trialing',
      source: 'api'
    });

    const logs = auditLogRepository.findAll();

    expect(logs).toHaveLength(1);
  });
});
