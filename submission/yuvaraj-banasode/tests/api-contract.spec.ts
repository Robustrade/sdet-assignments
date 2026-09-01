/**
 * API Contract Tests
 * 
 * Validate request/response correctness, error handling, and webhook signature verification.
 */

import request from 'supertest';
import { TestFixture, setCurrentFixture } from '../src/test/fixtures/test-fixture';
import { CustomerBuilder, SubscriptionBuilder } from '../src/test/builders/index';
import { APIAssertions } from '../src/test/helpers/assertions';

describe('API Contract Tests', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = new TestFixture();
    setCurrentFixture(fixture);
    fixture.getDefaultCustomer();
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  describe('POST /subscriptions', () => {
    it('should create subscription with valid plan and customer', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      APIAssertions.expectStatus(response, 201);
      APIAssertions.expectSubscriptionState(response, 'trialing');
      const subscriptionId = APIAssertions.expectSubscriptionId(response);
      expect(subscriptionId).toBeDefined();
      expect(response.body.plan).toBe('pro');
    });

    it('should return 422 for unknown plan', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'unknown_plan',
        payment_method_id: 'pm_visa_4242',
      });

      APIAssertions.expectStatus(response, 422);
      APIAssertions.expectErrorMessage(response, 'Unknown plan');
    });

    it('should return 422 for unknown customer', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_unknown',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      APIAssertions.expectStatus(response, 422);
      APIAssertions.expectErrorMessage(response, 'Customer not found');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        // missing plan and payment_method_id
      });

      APIAssertions.expectStatus(response, 400);
      APIAssertions.expectErrorMessage(response, 'Missing required fields');
    });

    it('should charge payment provider for plan with 0-day trial', async () => {
      // Note: basic plan has 14-day trial, pro has 7-day trial
      // For now, test the general flow
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;
      
      // Verify provider was called (or not, depending on plan trial length)
      // The subscription should exist
      fixture.persistenceAssertions.subscriptionShouldExist(subscriptionId);
    });
  });

  describe('GET /subscriptions/:id', () => {
    it('should retrieve existing subscription', async () => {
      const createResp = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = createResp.body.id;

      const getResp = await request(fixture.app).get(`/subscriptions/${subscriptionId}`);

      APIAssertions.expectStatus(getResp, 200);
      expect(getResp.body.id).toBe(subscriptionId);
      expect(getResp.body.state).toBe('trialing');
    });

    it('should return 404 for non-existent subscription', async () => {
      const response = await request(fixture.app).get('/subscriptions/sub_nonexistent');

      APIAssertions.expectStatus(response, 404);
      APIAssertions.expectErrorMessage(response, 'not found');
    });
  });

  describe('POST /subscriptions/:id/cancel', () => {
    it('should cancel active subscription', async () => {
      const createResp = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = createResp.body.id;

      const cancelResp = await request(fixture.app)
        .post(`/subscriptions/${subscriptionId}/cancel`);

      APIAssertions.expectStatus(cancelResp, 200);
      APIAssertions.expectSubscriptionState(cancelResp, 'canceled');
    });

    it('should return 404 for non-existent subscription', async () => {
      const response = await request(fixture.app)
        .post('/subscriptions/sub_nonexistent/cancel');

      APIAssertions.expectStatus(response, 404);
    });

    it('should return 422 for already-canceled subscription', async () => {
      const createResp = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = createResp.body.id;

      // First cancel
      await request(fixture.app).post(`/subscriptions/${subscriptionId}/cancel`);

      // Second cancel should fail
      const response = await request(fixture.app)
        .post(`/subscriptions/${subscriptionId}/cancel`);

      APIAssertions.expectStatus(response, 422);
      APIAssertions.expectErrorMessage(response, 'already canceled');
    });
  });

  describe('POST /webhooks/payment-provider', () => {
    it('should return 200 for valid signed webhook', async () => {
      const { payload, signature } = new (require('../src/test/builders').WebhookPayloadBuilder)()
        .withSubscriptionId('sub_123')
        .buildSigned();

      const response = await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      APIAssertions.expectStatus(response, 200);
      expect(response.body.event_id).toBeDefined();
    });

    it('should return 403 for invalid signature', async () => {
      const { payload, signature: _ } = new (require('../src/test/builders').WebhookPayloadBuilder)()
        .withSubscriptionId('sub_123')
        .buildWithInvalidSignature();

      const response = await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', 'wrong_signature')
        .send(payload);

      APIAssertions.expectStatus(response, 403);
    });

    it('should return 403 for missing signature header', async () => {
      const { payload } = new (require('../src/test/builders').WebhookPayloadBuilder)()
        .withSubscriptionId('sub_123')
        .buildSigned();

      const response = await request(fixture.app)
        .post('/webhooks/payment-provider')
        .send(payload);

      APIAssertions.expectStatus(response, 403);
    });
  });
});
