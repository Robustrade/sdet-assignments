/**
 * State Machine Tests
 * 
 * Validate subscription lifecycle transitions:
 * - Valid transitions occur correctly
 * - Invalid transitions are rejected or ignored
 * - State machine rules are enforced
 */

import request from 'supertest';
import { TestFixture, setCurrentFixture } from '../src/test/fixtures/test-fixture';
import { WebhookPayloadBuilder } from '../src/test/builders/index';

describe('State Machine Tests', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = new TestFixture();
    setCurrentFixture(fixture);
    fixture.getDefaultCustomer();
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  describe('Subscription Lifecycle Transitions', () => {
    it('should start subscription in trialing state', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;
      fixture.persistenceAssertions.subscriptionShouldBeTrialing(subscriptionId);
    });

    it('should transition from trialing to active on payment.succeeded webhook', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;

      // Verify initial state
      fixture.persistenceAssertions.subscriptionShouldBeTrialing(subscriptionId);

      // Send payment.succeeded webhook
      const { payload, signature } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      // Verify transition
      fixture.persistenceAssertions.subscriptionShouldBeActive(subscriptionId);
    });

    it('should transition from trialing to past_due on payment.failed webhook', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;

      // Send payment.failed webhook
      const { payload, signature } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.failed')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      // Verify transition
      fixture.persistenceAssertions.subscriptionShouldBePastDue(subscriptionId);
    });

    it('should transition from active to past_due on payment.failed webhook', async () => {
      // Create subscription
      const createResp = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = createResp.body.id;

      // Move to active
      const { payload: successPayload, signature: successSig } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', successSig)
        .send(successPayload);

      fixture.persistenceAssertions.subscriptionShouldBeActive(subscriptionId);

      // Move to past_due
      const { payload: failPayload, signature: failSig } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.failed')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', failSig)
        .send(failPayload);

      fixture.persistenceAssertions.subscriptionShouldBePastDue(subscriptionId);
    });

    it('should transition from past_due back to active on payment.succeeded webhook', async () => {
      // Create subscription
      const createResp = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = createResp.body.id;

      // Move to past_due
      const { payload: failPayload, signature: failSig } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.failed')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', failSig)
        .send(failPayload);

      fixture.persistenceAssertions.subscriptionShouldBePastDue(subscriptionId);

      // Move back to active
      const { payload: successPayload, signature: successSig } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', successSig)
        .send(successPayload);

      fixture.persistenceAssertions.subscriptionShouldBeActive(subscriptionId);
    });

    it('should allow cancellation from trialing state', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;

      const cancelResp = await request(fixture.app)
        .post(`/subscriptions/${subscriptionId}/cancel`);

      expect(cancelResp.status).toBe(200);
      fixture.persistenceAssertions.subscriptionShouldBeCanceled(subscriptionId);
    });

    it('should allow cancellation from active state', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;

      // Move to active
      const { payload, signature } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      const cancelResp = await request(fixture.app)
        .post(`/subscriptions/${subscriptionId}/cancel`);

      expect(cancelResp.status).toBe(200);
      fixture.persistenceAssertions.subscriptionShouldBeCanceled(subscriptionId);
    });

    it('should NOT transition from canceled state via webhook', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;

      // Cancel
      await request(fixture.app).post(`/subscriptions/${subscriptionId}/cancel`);
      fixture.persistenceAssertions.subscriptionShouldBeCanceled(subscriptionId);

      // Try to reactivate with webhook
      const { payload, signature } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      // Should still be canceled
      fixture.persistenceAssertions.subscriptionShouldBeCanceled(subscriptionId);
    });
  });

  describe('Invalid State Transitions', () => {
    it('should ignore payment.failed webhook when already canceled', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;

      // Cancel
      await request(fixture.app).post(`/subscriptions/${subscriptionId}/cancel`);

      // Send payment.failed webhook (should be ignored)
      const { payload, signature } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.failed')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      // Should remain canceled
      fixture.persistenceAssertions.subscriptionShouldBeCanceled(subscriptionId);
    });
  });
});
