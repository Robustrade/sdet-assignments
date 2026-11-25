
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

import { WebhookRepository } from '../../src/repositories/WebhookRepository.js';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository.js';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository.js';
import { AuditLogRepository } from '../../src/repositories/AuditLogRepository.js';

import { SubscriptionStateMachine } from '../../src/domain/subscription/SubscriptionStateMachine.js';
import { WebhookSignature } from '../../src/webhooks/WebhookSignature.js';
import { WebhookService } from '../../src/services/WebhookService.js';

describe('WebhookService', () => {
  let database: SqliteDatabase;
  let webhookRepository: WebhookRepository;
  let invoiceRepository: InvoiceRepository;
  let subscriptionRepository: SubscriptionRepository;
  let auditLogRepository: AuditLogRepository;
  let webhookService: WebhookService;

  const webhookSecret = 'test_webhook_secret';

  let subscriptionId: string;
  let invoiceId: string;

  function createWebhook(
    eventId: string,
    eventType: 'payment.succeeded' | 'payment.failed',
    overrides: Record<string, unknown> = {}
  ) {
    const payload = {
      event_id: eventId,
      event_type: eventType,
      created_at: new Date().toISOString(),
      data: {
        invoice_id: invoiceId,
        subscription_id: subscriptionId,
        ...(eventType === 'payment.succeeded'
          ? { provider_reference: 'pay_ref_001' }
          : { failure_reason: 'Payment declined' })
      },
      ...overrides
    };

    const rawBody = JSON.stringify(payload);
    const signature = WebhookSignature.generate(rawBody, webhookSecret);

    return { rawBody, signature };
  }

  function createAdditionalInvoice(id: string): void {
    invoiceRepository.create({
      id,
      subscription_id: subscriptionId,
      amount: 1900,
      currency: 'USD',
      status: 'pending',
      billing_period_start: '2026-12-25T00:00:00.000Z',
      billing_period_end: '2027-01-25T00:00:00.000Z'
    });
  }

  beforeEach(() => {
    database = new SqliteDatabase(':memory:');

    initializeSchema(database.connection);
    new DatabaseSeeder(database.connection).seed();

    webhookRepository = new WebhookRepository(database.connection);
    invoiceRepository = new InvoiceRepository(database.connection);
    subscriptionRepository = new SubscriptionRepository(database.connection);
    auditLogRepository = new AuditLogRepository(database.connection);

    const stateMachine = new SubscriptionStateMachine();

    webhookService = new WebhookService(
      database.connection,
      webhookRepository,
      invoiceRepository,
      subscriptionRepository,
      auditLogRepository,
      stateMachine,
      webhookSecret
    );

    subscriptionId = 'sub_webhook_001';

    subscriptionRepository.create({
      id: subscriptionId,
      customer_id: 'cust_001',
      plan_id: 'plan_basic',
      payment_method_id: 'pm_test_001',
      status: 'trialing',
      trial_ends_at: '2026-12-02T00:00:00.000Z',
      current_period_start: '2026-11-25T00:00:00.000Z'
    });

    invoiceId = 'inv_webhook_001';

    invoiceRepository.create({
      id: invoiceId,
      subscription_id: subscriptionId,
      amount: 1900,
      currency: 'USD',
      status: 'pending',
      billing_period_start: '2026-11-25T00:00:00.000Z',
      billing_period_end: '2026-12-25T00:00:00.000Z'
    });
  });

  afterEach(() => {
    database.close();
  });

  it('should activate a trialing subscription after successful payment webhook', async () => {
    const webhook = createWebhook('evt_success_001', 'payment.succeeded');

    const result = await webhookService.processWebhook(
      webhook.rawBody,
      webhook.signature
    );

    expect(result.status).toBe('processed');
    expect(subscriptionRepository.findById(subscriptionId)?.status).toBe('active');
    expect(invoiceRepository.findById(invoiceId)?.status).toBe('succeeded');
    expect(webhookRepository.findById('evt_success_001')?.processing_status)
      .toBe('processed');
  });

  it('should move a trialing subscription to past_due after failed payment webhook', async () => {
    const webhook = createWebhook('evt_failed_001', 'payment.failed');

    const result = await webhookService.processWebhook(
      webhook.rawBody,
      webhook.signature
    );

    expect(result.status).toBe('processed');
    expect(subscriptionRepository.findById(subscriptionId)?.status).toBe('past_due');
    expect(invoiceRepository.findById(invoiceId)?.status).toBe('failed');
  });

  it('should reject webhook with invalid signature', async () => {
    const webhook = createWebhook(
      'evt_invalid_signature',
      'payment.succeeded'
    );

    const result = await webhookService.processWebhook(
      webhook.rawBody,
      'invalid-signature'
    );

    expect(result.status).toBe('invalid');
    expect(subscriptionRepository.findById(subscriptionId)?.status).toBe('trialing');
    expect(webhookRepository.findById('evt_invalid_signature')).toBeNull();
  });

  it('should reject malformed JSON payload', async () => {
    const rawBody = '{ invalid json';
    const signature = WebhookSignature.generate(rawBody, webhookSecret);

    const result = await webhookService.processWebhook(rawBody, signature);

    expect(result.status).toBe('invalid');
    expect(webhookRepository.findById('evt_malformed')).toBeNull();
  });

  it('should ignore duplicate webhook events', async () => {
    const webhook = createWebhook('evt_duplicate_001', 'payment.succeeded');

    const firstResult = await webhookService.processWebhook(
      webhook.rawBody,
      webhook.signature
    );

    const secondResult = await webhookService.processWebhook(
      webhook.rawBody,
      webhook.signature
    );

    expect(firstResult.status).toBe('processed');
    expect(secondResult.status).toBe('duplicate');
    expect(subscriptionRepository.findById(subscriptionId)?.status).toBe('active');
    expect(webhookRepository.findById('evt_duplicate_001')).not.toBeNull();
  });

  it('should reject webhook referencing an unknown invoice', async () => {
    const webhook = createWebhook(
      'evt_unknown_invoice',
      'payment.succeeded',
      {
        data: {
          invoice_id: 'inv_unknown',
          subscription_id: subscriptionId,
          provider_reference: 'pay_ref_001'
        }
      }
    );

    const result = await webhookService.processWebhook(
      webhook.rawBody,
      webhook.signature
    );

    expect(result.status).toBe('invalid');
    expect(subscriptionRepository.findById(subscriptionId)?.status).toBe('trialing');
  });

  it('should reject invoice belonging to another subscription', async () => {
    subscriptionRepository.create({
      id: 'sub_another',
      customer_id: 'cust_002',
      plan_id: 'plan_basic',
      payment_method_id: 'pm_test_002',
      status: 'trialing',
      trial_ends_at: '2026-12-02T00:00:00.000Z',
      current_period_start: '2026-11-25T00:00:00.000Z'
    });

    const webhook = createWebhook(
      'evt_mismatch_001',
      'payment.succeeded',
      {
        data: {
          invoice_id: invoiceId,
          subscription_id: 'sub_another',
          provider_reference: 'pay_ref_001'
        }
      }
    );

    const result = await webhookService.processWebhook(
      webhook.rawBody,
      webhook.signature
    );

    expect(result.status).toBe('invalid');
    expect(result.message).toBe('Invoice does not belong to subscription');
    expect(invoiceRepository.findById(invoiceId)?.status).toBe('pending');
    expect(webhookRepository.findById('evt_mismatch_001')?.processing_status)
      .toBe('failed');
  });

  it('should ignore failure webhook for an already successful invoice', async () => {
    const successWebhook = createWebhook(
      'evt_success_before_failure',
      'payment.succeeded'
    );

    await webhookService.processWebhook(
      successWebhook.rawBody,
      successWebhook.signature
    );

    const failureWebhook = createWebhook(
      'evt_failure_after_success',
      'payment.failed'
    );

    const result = await webhookService.processWebhook(
      failureWebhook.rawBody,
      failureWebhook.signature
    );

    expect(result.status).toBe('ignored');
    expect(subscriptionRepository.findById(subscriptionId)?.status).toBe('active');
    expect(invoiceRepository.findById(invoiceId)?.status).toBe('succeeded');
  });

  it('should reactivate a past_due subscription after successful retry webhook', async () => {
    subscriptionRepository.updateStatus(subscriptionId, 'past_due');

    const webhook = createWebhook('evt_retry_success', 'payment.succeeded');

    const result = await webhookService.processWebhook(
      webhook.rawBody,
      webhook.signature
    );

    expect(result.status).toBe('processed');
    expect(subscriptionRepository.findById(subscriptionId)?.status).toBe('active');
    expect(invoiceRepository.findById(invoiceId)?.status).toBe('succeeded');
  });

  it('should ignore webhook for a canceled subscription', async () => {
    subscriptionRepository.updateStatus(subscriptionId, 'canceled');

    const webhook = createWebhook(
      'evt_canceled_subscription',
      'payment.succeeded'
    );

    const result = await webhookService.processWebhook(
      webhook.rawBody,
      webhook.signature
    );

    expect(result.status).toBe('ignored');
    expect(subscriptionRepository.findById(subscriptionId)?.status).toBe('canceled');
  });

  it('should ignore an older failed payment event after a newer successful payment', async () => {
    createAdditionalInvoice('inv_webhook_002');

    const newerSuccess = createWebhook(
      'evt_newer_success',
      'payment.succeeded',
      {
        created_at: '2026-11-25T10:30:00.000Z'
      }
    );

    const successResult = await webhookService.processWebhook(
      newerSuccess.rawBody,
      newerSuccess.signature
    );

    expect(successResult.status).toBe('processed');

    const olderFailure = createWebhook(
      'evt_older_failure',
      'payment.failed',
      {
        created_at: '2026-11-25T10:15:00.000Z',
        data: {
          invoice_id: 'inv_webhook_002',
          subscription_id: subscriptionId,
          failure_reason: 'Delayed payment failure'
        }
      }
    );

    const failureResult = await webhookService.processWebhook(
      olderFailure.rawBody,
      olderFailure.signature
    );

    expect(failureResult.status).toBe('ignored');
    expect(failureResult.message).toContain('Older payment event');

    expect(subscriptionRepository.findById(subscriptionId)?.status)
      .toBe('active');

    expect(invoiceRepository.findById(invoiceId)?.status)
      .toBe('succeeded');

    expect(invoiceRepository.findById('inv_webhook_002')?.status)
      .toBe('pending');

    expect(webhookRepository.findById('evt_older_failure')?.processing_status)
      .toBe('ignored');
  });

  it('should ignore an older successful payment event after a newer failed payment', async () => {
    createAdditionalInvoice('inv_webhook_002');

    const newerFailure = createWebhook(
      'evt_newer_failure',
      'payment.failed',
      {
        created_at: '2026-11-25T10:30:00.000Z'
      }
    );

    const failureResult = await webhookService.processWebhook(
      newerFailure.rawBody,
      newerFailure.signature
    );

    expect(failureResult.status).toBe('processed');

    const olderSuccess = createWebhook(
      'evt_older_success',
      'payment.succeeded',
      {
        created_at: '2026-11-25T10:15:00.000Z',
        data: {
          invoice_id: 'inv_webhook_002',
          subscription_id: subscriptionId,
          provider_reference: 'delayed_payment_reference'
        }
      }
    );

    const successResult = await webhookService.processWebhook(
      olderSuccess.rawBody,
      olderSuccess.signature
    );

    expect(successResult.status).toBe('ignored');
    expect(successResult.message).toContain('Older payment event');

    expect(subscriptionRepository.findById(subscriptionId)?.status)
      .toBe('past_due');

    expect(invoiceRepository.findById(invoiceId)?.status)
      .toBe('failed');

    expect(invoiceRepository.findById('inv_webhook_002')?.status)
      .toBe('pending');

    expect(webhookRepository.findById('evt_older_success')?.processing_status)
      .toBe('ignored');
  });
});
