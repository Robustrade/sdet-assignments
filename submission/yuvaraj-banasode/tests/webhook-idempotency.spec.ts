/**
 * Webhook Idempotency Tests
 * 
 * Mandatory tests for duplicate webhook delivery.
 * Verify that the same event processed multiple times has no duplicate side effects.
 */

import request from 'supertest';
import { TestFixture, setCurrentFixture } from '../src/test/fixtures/test-fixture';
import { WebhookPayloadBuilder } from '../src/test/builders/index';

describe('Webhook Idempotency Tests', () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = new TestFixture();
    setCurrentFixture(fixture);
    fixture.getDefaultCustomer();
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  describe('Duplicate Event ID Handling', () => {
    it('should process same event_id exactly once', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;
      const eventId = 'evt_unique_001';

      // Create webhook payload with specific event_id
      const webhookBuilder = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .withEventId(eventId);

      const { payload, signature } = webhookBuilder.buildSigned();

      // Send webhook first time
      const resp1 = await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      expect(resp1.status).toBe(200);
      expect(resp1.body.processed).toBe(true);

      // Verify subscription transitioned to active
      fixture.persistenceAssertions.subscriptionShouldBeActive(subscriptionId);

      // Send identical webhook second time
      const resp2 = await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      expect(resp2.status).toBe(200);
      expect(resp2.body.processed).toBe(false); // Already processed

      // Verify subscription is still active (no regression)
      fixture.persistenceAssertions.subscriptionShouldBeActive(subscriptionId);
    });

    it('should not create duplicate invoice for replay webhook', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;
      const eventId = 'evt_invoice_dedup';

      const webhookBuilder = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .withEventId(eventId);

      const { payload, signature } = webhookBuilder.buildSigned();

      // Send webhook first time
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      // Get invoice count
      const invoices1 = fixture.invoiceRepo.findBySubscriptionId(subscriptionId);
      const invoiceCount1 = invoices1.length;

      // Send identical webhook second time
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      // Verify no new invoice created
      const invoices2 = fixture.invoiceRepo.findBySubscriptionId(subscriptionId);
      const invoiceCount2 = invoices2.length;

      expect(invoiceCount2).toBe(invoiceCount1); // Should not increase
    });

    it('should not call payment provider twice for duplicate webhook', async () => {
      // Set up: create subscription and configure provider to be called
      // Note: In current implementation, provider is only called on subscription creation
      // This test documents the expected behavior for billing attempts via webhook

      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;
      const initialCallCount = fixture.getPaymentProviderCalls().length;

      const eventId = 'evt_provider_dedup';

      const webhookBuilder = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .withEventId(eventId);

      const { payload, signature } = webhookBuilder.buildSigned();

      // Send webhook first time
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      const callCount1 = fixture.getPaymentProviderCalls().length;

      // Send identical webhook second time
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      const callCount2 = fixture.getPaymentProviderCalls().length;

      // Provider should not be called again for the duplicate
      expect(callCount2).toBe(callCount1);
    });

    it('should store webhook event exactly once despite multiple deliveries', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;
      const eventId = 'evt_storage_dedup';

      const webhookBuilder = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .withEventId(eventId);

      const { payload, signature } = webhookBuilder.buildSigned();

      // Send webhook first time
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      // Send identical webhook second time
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      // Verify event appears exactly once in storage
      fixture.persistenceAssertions.webhookEventShouldAppearExactlyOnce(eventId);
    });
  });

  describe('Duplicate Prevention with Different Signatures', () => {
    it('should reject replay with invalid signature', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;
      const eventId = 'evt_sig_validation';

      const webhookBuilder = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .withEventId(eventId);

      const { payload, signature } = webhookBuilder.buildSigned();

      // Send with valid signature
      const resp1 = await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', signature)
        .send(payload);

      expect(resp1.status).toBe(200);

      // Try to send with invalid signature
      const resp2 = await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', 'wrong_signature_xyz')
        .send(payload);

      expect(resp2.status).toBe(403); // Signature validation fails first
    });
  });

  describe('State Machine Idempotency', () => {
    it('should not regress subscription state with late-arriving webhook', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;

      // Move subscription to active
      const { payload: successPayload, signature: successSig } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.succeeded')
        .withEventId('evt_001')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', successSig)
        .send(successPayload);

      fixture.persistenceAssertions.subscriptionShouldBeActive(subscriptionId);

      // Send a late-arriving failure webhook with a different event_id
      const { payload: failPayload, signature: failSig } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.failed')
        .withEventId('evt_002_late')
        .buildSigned();

      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', failSig)
        .send(failPayload);

      // Subscription should now be past_due
      fixture.persistenceAssertions.subscriptionShouldBePastDue(subscriptionId);

      // Replay the failure webhook again
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', failSig)
        .send(failPayload);

      // Should still be past_due (no regression to active, no double-processing)
      fixture.persistenceAssertions.subscriptionShouldBePastDue(subscriptionId);
    });

    it('should ignore duplicate failure webhook for already-active subscription', async () => {
      const response = await request(fixture.app).post('/subscriptions').send({
        customer_id: 'cust_default',
        plan: 'pro',
        payment_method_id: 'pm_visa_4242',
      });

      const subscriptionId = response.body.id;

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

      // Send a late/duplicate payment.failed webhook
      const { payload: failPayload, signature: failSig } = new WebhookPayloadBuilder()
        .withSubscriptionId(subscriptionId)
        .withType('payment.failed')
        .withEventId('evt_duplicate_fail')
        .buildSigned();

      // First time it arrives
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', failSig)
        .send(failPayload);

      let subscription = fixture.subscriptionRepo.findById(subscriptionId);
      const state1 = subscription!.state;

      // Replay the same failure webhook
      await request(fixture.app)
        .post('/webhooks/payment-provider')
        .set('X-Provider-Signature', failSig)
        .send(failPayload);

      subscription = fixture.subscriptionRepo.findById(subscriptionId);
      const state2 = subscription!.state;

      // State should be consistent (either past_due or active, not inconsistent)
      expect(state2).toBe(state1);
    });
  });
});
