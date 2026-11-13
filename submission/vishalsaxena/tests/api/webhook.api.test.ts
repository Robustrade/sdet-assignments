import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app';
import { createDatabase, AppDatabase } from '../../src/database/database';

import { CustomerRepository } from '../../src/repositories/CustomerRepository';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository';
import { PaymentRepository } from '../../src/repositories/PaymentRepository';
import { WebhookRepository } from '../../src/repositories/WebhookRepository';

import { SubscriptionService } from '../../src/services/SubscriptionService';
import { PaymentService } from '../../src/services/PaymentService';
import { WebhookService } from '../../src/services/WebhookService';

import { MockPaymentProvider } from '../../src/providers/MockPaymentProvider';
import { createCustomer } from '../../src/models/Customer';
import { createSubscription } from '../../src/models/Subscription';
import { createInvoice } from '../../src/models/Invoice';
import { createPayment } from '../../src/models/Payment';

import { generateWebhookSignature } from '../../src/utils/webhookSignature';
import { webhookConfig } from '../../src/config/webhook.config';

describe('Webhook API', () => {
    let db: AppDatabase;
    let app: ReturnType<typeof createApp>;
  
    let invoiceRepository: InvoiceRepository;
    let paymentRepository: PaymentRepository;
    let subscriptionRepository: SubscriptionRepository;
    let webhookRepository: WebhookRepository;
  
    beforeEach(async () => {
      db = await createDatabase();
  
      const customerRepository = new CustomerRepository(db);
      subscriptionRepository = new SubscriptionRepository(db);
      invoiceRepository = new InvoiceRepository(db);
      paymentRepository = new PaymentRepository(db);
      webhookRepository = new WebhookRepository(db);
  
      customerRepository.create(
        createCustomer('cus_001', 'test@example.com')
      );
  
      subscriptionRepository.create(
        createSubscription('sub_001', 'cus_001', 'plan_basic')
      );
  
      invoiceRepository.create(
        createInvoice(
          'inv_001',
          'sub_001',
          4900,
          '2026-11-01',
          '2026-12-01'
        )
      );
  
      paymentRepository.create(
        createPayment('pay_001', 'inv_001', 4900)
      );
  
      const subscriptionService = new SubscriptionService(
        customerRepository,
        subscriptionRepository
      );
  
      const paymentService = new PaymentService(
        db,
        invoiceRepository,
        paymentRepository,
        subscriptionRepository,
        new MockPaymentProvider()
      );
  
      const webhookService = new WebhookService(
        db,
        webhookRepository,
        invoiceRepository,
        paymentRepository,
        subscriptionRepository
      );
  
      app = createApp(
        subscriptionService,
        paymentService,
        webhookService
      );
    });
  
    afterEach(() => {
      db.close();
    });

    it('should process a valid payment succeeded webhook', async () => {
        const payload = {
          event_id: 'evt_api_001',
          type: 'payment.succeeded',
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
      
        const response = await request(app)
          .post('/webhooks/payment-provider')
          .set('X-Provider-Signature', signature)
          .send(payload);
      
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          received: true,
          duplicate: false
        });
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('succeeded');
        expect(invoiceRepository.findById('inv_001')?.status).toBe('paid');
        expect(subscriptionRepository.findById('sub_001')?.status).toBe('active');
      
        expect(
          webhookRepository.findByProviderEventId('evt_api_001')?.status
        ).toBe('processed');
      });

      it('should reject an invalid webhook signature', async () => {
        const payload = {
          event_id: 'evt_invalid_001',
          type: 'payment.succeeded',
          subscription_id: 'sub_001',
          invoice_id: 'inv_001',
          amount: 4900,
          currency: 'USD'
        };
      
        const response = await request(app)
          .post('/webhooks/payment-provider')
          .set('X-Provider-Signature', 'invalid_signature')
          .send(payload);
      
        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid webhook signature');
      
        expect(
          webhookRepository.findByProviderEventId('evt_invalid_001')
        ).toBeUndefined();
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('pending');
      });

      it('should not process the same webhook event twice', async () => {
        const payload = {
          event_id: 'evt_duplicate_001',
          type: 'payment.succeeded',
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
      
        const firstResponse = await request(app)
          .post('/webhooks/payment-provider')
          .set('X-Provider-Signature', signature)
          .send(payload);
      
        const secondResponse = await request(app)
          .post('/webhooks/payment-provider')
          .set('X-Provider-Signature', signature)
          .send(payload);
      
        expect(firstResponse.status).toBe(200);
        expect(firstResponse.body.duplicate).toBe(false);
      
        expect(secondResponse.status).toBe(200);
        expect(secondResponse.body.duplicate).toBe(true);
      
        expect(
          webhookRepository.findByProviderEventId('evt_duplicate_001')?.status
        ).toBe('processed');
      });

      it('should reject a webhook request without a signature', async () => {
        const payload = {
          event_id: 'evt_missing_signature',
          type: 'payment.succeeded',
          subscription_id: 'sub_001',
          invoice_id: 'inv_001',
          amount: 4900,
          currency: 'USD'
        };
      
        const response = await request(app)
          .post('/webhooks/payment-provider')
          .send(payload);
      
        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Missing webhook signature');
      
        expect(
          webhookRepository.findByProviderEventId('evt_missing_signature')
        ).toBeUndefined();
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('pending');
      });

      it('should reject a webhook with an incorrect payment amount', async () => {
        const payload = {
          event_id: 'evt_wrong_amount',
          type: 'payment.succeeded',
          subscription_id: 'sub_001',
          invoice_id: 'inv_001',
          amount: 5000,
          currency: 'USD'
        };
      
        const rawBody = JSON.stringify(payload);
        const signature = generateWebhookSignature(
          rawBody,
          webhookConfig.secret
        );
      
        const response = await request(app)
          .post('/webhooks/payment-provider')
          .set('X-Provider-Signature', signature)
          .send(payload);
      
        expect(response.status).toBe(400);
        expect(response.body.error).toBe(
          'Webhook payment details do not match invoice'
        );
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('pending');
      
        expect(
          webhookRepository.findByProviderEventId('evt_wrong_amount')
        ).toBeUndefined();
      });

      it('should reject a webhook with an incorrect currency', async () => {
        const payload = {
          event_id: 'evt_wrong_currency',
          type: 'payment.succeeded',
          subscription_id: 'sub_001',
          invoice_id: 'inv_001',
          amount: 4900,
          currency: 'EUR'
        };
      
        const rawBody = JSON.stringify(payload);
        const signature = generateWebhookSignature(
          rawBody,
          webhookConfig.secret
        );
      
        const response = await request(app)
          .post('/webhooks/payment-provider')
          .set('X-Provider-Signature', signature)
          .send(payload);
      
        expect(response.status).toBe(400);
        expect(response.body.error).toBe(
          'Webhook payment details do not match invoice'
        );
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('pending');
      
        expect(
          webhookRepository.findByProviderEventId('evt_wrong_currency')
        ).toBeUndefined();
      });

      it('should not allow a late payment.failed event to reverse a successful payment', async () => {
        const sendWebhook = async (eventId: string, type: string) => {
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
      
          return request(app)
            .post('/webhooks/payment-provider')
            .set('X-Provider-Signature', signature)
            .send(payload);
        };
      
        const successResponse = await sendWebhook(
          'evt_success_first',
          'payment.succeeded'
        );
      
        const lateFailureResponse = await sendWebhook(
          'evt_failure_later',
          'payment.failed'
        );
      
        expect(successResponse.status).toBe(200);
        expect(lateFailureResponse.status).toBe(200);
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('succeeded');
        expect(invoiceRepository.findById('inv_001')?.status).toBe('paid');
        expect(subscriptionRepository.findById('sub_001')?.status).toBe('active');
      });

      it('should not reactivate a canceled subscription after payment success', async () => {
        subscriptionRepository.updateStatus('sub_001', 'canceled');
      
        const payload = {
          event_id: 'evt_canceled_sub',
          type: 'payment.succeeded',
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
      
        const response = await request(app)
          .post('/webhooks/payment-provider')
          .set('X-Provider-Signature', signature)
          .send(payload);
      
        expect(response.status).toBe(200);
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('succeeded');
        expect(invoiceRepository.findById('inv_001')?.status).toBe('paid');
        expect(subscriptionRepository.findById('sub_001')?.status).toBe('canceled');
      });

      it('should reject an unsupported webhook event type', async () => {
        const payload = {
          event_id: 'evt_unsupported',
          type: 'payment.pending',
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
      
        const response = await request(app)
          .post('/webhooks/payment-provider')
          .set('X-Provider-Signature', signature)
          .send(payload);
      
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Unsupported webhook event type');
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('pending');
      
        expect(
          webhookRepository.findByProviderEventId('evt_unsupported')
        ).toBeUndefined();
      });

      it('should process a payment.refunded webhook', async () => {
        const sendWebhook = async (eventId: string, type: string) => {
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
      
          return request(app)
            .post('/webhooks/payment-provider')
            .set('X-Provider-Signature', signature)
            .send(payload);
        };
      
        const successResponse = await sendWebhook(
          'evt_refund_success',
          'payment.succeeded'
        );
      
        const refundResponse = await sendWebhook(
          'evt_refund_001',
          'payment.refunded'
        );
      
        expect(successResponse.status).toBe(200);
        expect(refundResponse.status).toBe(200);
      
        expect(paymentRepository.findById('pay_001')?.status).toBe('refunded');
        expect(invoiceRepository.findById('inv_001')?.status).toBe('paid');
      
        expect(
          webhookRepository.findByProviderEventId('evt_refund_001')?.status
        ).toBe('processed');
      });
  });