
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import request from 'supertest';

import { createTestContext } from '../fixtures/testContext.js';
import { WebhookSignature } from '../../src/webhooks/WebhookSignature.js';


describe('Subscription Billing API', () => {
  let context: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    context = createTestContext();
  });

  afterEach(() => {
    context.cleanup();
  });

  describe('GET /health', () => {
    it('should return API health status', async () => {
      const response = await request(context.app)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /subscriptions', () => {
    it('should create a subscription with valid data', async () => {
      const response = await request(context.app)
        .post('/subscriptions')
        .send({
          customerId: 'cust_001',
          planId: 'plan_basic',
          paymentMethodId: 'pm_test_001'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('trialing');
      expect(response.body.data.id).toBeDefined();
    });

    it('should reject missing required fields', async () => {
      const response = await request(context.app)
        .post('/subscriptions')
        .send({
          customerId: 'cust_001'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should reject an empty customer ID', async () => {
      const response = await request(context.app)
        .post('/subscriptions')
        .send({
          customerId: '   ',
          planId: 'plan_basic',
          paymentMethodId: 'pm_test_001'
        });

      expect(response.status).toBe(400);
    });

    it('should return 404 when the customer does not exist', async () => {
      const response = await request(context.app)
        .post('/subscriptions')
        .send({
          customerId: 'unknown_customer',
          planId: 'plan_basic',
          paymentMethodId: 'pm_test_001'
        });

      expect(response.status).toBe(404);
    });

    it('should return 404 when the plan does not exist', async () => {
      const response = await request(context.app)
        .post('/subscriptions')
        .send({
          customerId: 'cust_001',
          planId: 'unknown_plan',
          paymentMethodId: 'pm_test_001'
        });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /subscriptions/:id', () => {
    it('should return an existing subscription', async () => {
      const createResponse = await request(context.app)
        .post('/subscriptions')
        .send({
          customerId: 'cust_001',
          planId: 'plan_basic',
          paymentMethodId: 'pm_test_001'
        });

      const subscriptionId = createResponse.body.data.id;

      const response = await request(context.app)
        .get(`/subscriptions/${subscriptionId}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(subscriptionId);
      expect(response.body.data.status).toBe('trialing');
    });

    it('should return 404 for an unknown subscription ID', async () => {
      const response = await request(context.app)
        .get('/subscriptions/unknown_subscription');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Subscription not found');
    });
  });

  describe('POST /subscriptions/:id/cancel', () => {
    it('should cancel an existing subscription', async () => {
      const createResponse = await request(context.app)
        .post('/subscriptions')
        .send({
          customerId: 'cust_001',
          planId: 'plan_basic',
          paymentMethodId: 'pm_test_001'
        });

      const subscriptionId = createResponse.body.data.id;

      const response = await request(context.app)
        .post(`/subscriptions/${subscriptionId}/cancel`);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('canceled');
    });

    it('should return 404 when canceling an unknown subscription', async () => {
      const response = await request(context.app)
        .post('/subscriptions/unknown_subscription/cancel');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /webhooks/payment-provider', () => {
    it('should reject a webhook with an invalid signature', async () => {
      const rawBody = JSON.stringify({
        event_id: 'evt_test_001',
        event_type: 'payment.succeeded'
      });

      const response = await request(context.app)
        .post('/webhooks/payment-provider')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', 'invalid-signature')
        .send(rawBody);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject malformed JSON with a valid signature', async () => {
      const rawBody = '{invalid-json';

      const signature = WebhookSignature.generate(
        rawBody,
        context.webhookSecret
      );

      const response = await request(context.app)
        .post('/webhooks/payment-provider')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', signature)
        .send(rawBody);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Unknown routes', () => {
    it('should return 404 for an unknown endpoint', async () => {
      const response = await request(context.app)
        .get('/unknown-endpoint');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Route not found');
    });
  });
});
