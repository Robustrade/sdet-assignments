
import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase, AppDatabase } from '../../src/database/database';

import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository';
import { PaymentRepository } from '../../src/repositories/PaymentRepository';
import { WebhookRepository } from '../../src/repositories/WebhookRepository';

import { createCustomer } from '../../src/models/Customer';
import { createSubscription } from '../../src/models/Subscription';
import { createInvoice } from '../../src/models/Invoice';
import { createPayment } from '../../src/models/Payment';

import { WebhookService } from '../../src/services/WebhookService';
import { generateWebhookSignature } from '../../src/utils/webhookSignature';
import { webhookConfig } from '../../src/config/webhook.config';

describe('WebhookService', () => {
  let db: AppDatabase;
  let subscriptionRepo: SubscriptionRepository;
  let invoiceRepo: InvoiceRepository;
  let paymentRepo: PaymentRepository;
  let webhookRepo: WebhookRepository;
  let webhookService: WebhookService;

  beforeEach(async () => {
    db = await createDatabase();

    const customerRepo = new CustomerRepository(db);
    subscriptionRepo = new SubscriptionRepository(db);
    invoiceRepo = new InvoiceRepository(db);
    paymentRepo = new PaymentRepository(db);
    webhookRepo = new WebhookRepository(db);

    customerRepo.create(
      createCustomer('cust_001', 'test@example.com')
    );

    subscriptionRepo.create(
      createSubscription('sub_001', 'cust_001', 'plan_001')
    );

    invoiceRepo.create(
      createInvoice(
        'inv_001',
        'sub_001',
        4900,
        '2026-11-01',
        '2026-12-01'
      )
    );

    paymentRepo.create(
      createPayment('payment_001', 'inv_001', 4900)
    );

    webhookService = new WebhookService(
      db,
      webhookRepo,
      invoiceRepo,
      paymentRepo,
      subscriptionRepo
    );
  });

  function sendWebhook(
    eventId: string,
    type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded'
  ) {
    const payload = {
      event_id: eventId,
      type,
      subscription_id: 'sub_001',
      invoice_id: 'inv_001',
      amount: 4900,
      currency: 'USD'
    };

    const rawBody = JSON.stringify(payload);
    const signature = generateWebhookSignature(
      rawBody,
      webhookConfig.secret
    );

    return webhookService.process(rawBody, signature);
  }

  it('should persist webhook events', () => {
    webhookRepo.create({
      id: 'wh_001',
      providerEventId: 'evt_001',
      eventType: 'payment.succeeded',
      payload: { invoice_id: 'inv_001' }
    });

    const event = webhookRepo.findByProviderEventId('evt_001');

    expect(event).toBeDefined();
    expect(event?.status).toBe('received');
  });

  it('should prevent duplicate provider event IDs', () => {
    const event = {
      id: 'wh_001',
      providerEventId: 'evt_001',
      eventType: 'payment.succeeded',
      payload: {}
    };

    webhookRepo.create(event);

    expect(() => webhookRepo.create({
      ...event,
      id: 'wh_002'
    })).toThrow();
  });

  it('should process successful payment webhook', () => {
    sendWebhook('evt_success', 'payment.succeeded');

    expect(paymentRepo.findById('payment_001')?.status).toBe('succeeded');
    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
  });

  it('should move subscription to past_due after failed payment', () => {
    sendWebhook('evt_failed', 'payment.failed');

    expect(paymentRepo.findById('payment_001')?.status).toBe('failed');
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('past_due');
    expect(invoiceRepo.findById('inv_001')?.status).toBe('open');
  });

  it('should mark successful payment as refunded', () => {
    paymentRepo.updateStatus('payment_001', 'succeeded');
    invoiceRepo.updateStatus('inv_001', 'paid');
    subscriptionRepo.updateStatus('sub_001', 'active');

    sendWebhook('evt_refund', 'payment.refunded');

    expect(paymentRepo.findById('payment_001')?.status).toBe('refunded');
  });

  it('should not reverse successful payment after late failure event', () => {
    paymentRepo.updateStatus('payment_001', 'succeeded');
    invoiceRepo.updateStatus('inv_001', 'paid');
    subscriptionRepo.updateStatus('sub_001', 'active');

    sendWebhook('evt_late_failure', 'payment.failed');

    expect(paymentRepo.findById('payment_001')?.status).toBe('succeeded');
    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
  });

  it('should never reactivate a canceled subscription', () => {
    subscriptionRepo.updateStatus('sub_001', 'canceled');

    sendWebhook('evt_canceled', 'payment.succeeded');

    expect(paymentRepo.findById('payment_001')?.status).toBe('succeeded');
    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('canceled');
  });

  it('should process duplicate webhook delivery only once', () => {
    const firstResult = sendWebhook('evt_duplicate', 'payment.succeeded');
    const secondResult = sendWebhook('evt_duplicate', 'payment.succeeded');

    expect(firstResult.duplicate).toBe(false);
    expect(secondResult.duplicate).toBe(true);

    expect(
      webhookRepo.findByProviderEventId('evt_duplicate')?.status
    ).toBe('processed');
  });

  it('should rollback all changes when webhook processing fails', () => {
    const originalUpdateStatus = invoiceRepo.updateStatus;
  
    invoiceRepo.updateStatus = () => {
      throw new Error('Simulated database failure');
    };
  
    expect(() => {
      sendWebhook('evt_rollback', 'payment.succeeded');
    }).toThrow('Simulated database failure');
  
    // Payment update must also be rolled back.
    expect(
      paymentRepo.findById('payment_001')?.status
    ).toBe('pending');
  
    // Invoice must remain open.
    expect(
      invoiceRepo.findById('inv_001')?.status
    ).toBe('open');
  
    // Subscription must remain trialing.
    expect(
      subscriptionRepo.findById('sub_001')?.status
    ).toBe('trialing');
  
    // Failed webhook event must not be persisted.
    expect(
      webhookRepo.findByProviderEventId('evt_rollback')
    ).toBeUndefined();
  
    invoiceRepo.updateStatus = originalUpdateStatus;
  });
});
