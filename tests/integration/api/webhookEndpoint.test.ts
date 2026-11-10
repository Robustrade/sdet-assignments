import request from 'supertest';
import { setupTestEnvironment, TestContext } from '../setup';
import { SubscriptionBuilder } from '../../builders/SubscriptionBuilder';
import { InvoiceBuilder } from '../../builders/InvoiceBuilder';
import { WebhookPayloadFactory } from '../../builders/WebhookPayloadFactory';

describe('API Integration - POST /webhooks/payment-provider', () => {
  let context: TestContext;

  beforeEach(() => {
    context = setupTestEnvironment();
  });

  test('POST /webhooks with valid signature returns 200', async () => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_001')
      .trialing()
      .build();

    const invoice = new InvoiceBuilder()
      .withSubscriptionId(subscription.id)
      .pending()
      .build();

    await context.subscriptionRepo.save(subscription);
    await context.invoiceRepo.save(invoice);

    const webhook = WebhookPayloadFactory.createPaymentSucceeded(subscription.id, invoice.id);
    const signature = WebhookPayloadFactory.signPayload(webhook);

    const response = await request(context.app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook)
      .expect(200);

    expect(response.body).toHaveProperty('message');
  });

  test('POST /webhooks with invalid signature returns 403', async () => {
    const webhook = WebhookPayloadFactory.createPaymentSucceeded('sub_001', 'inv_001');

    const response = await request(context.app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', 'invalid_signature_abc123')
      .send(webhook)
      .expect(403);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('Invalid signature');
  });

  test('POST /webhooks with missing signature returns 401', async () => {
    const webhook = WebhookPayloadFactory.createPaymentSucceeded('sub_001', 'inv_001');

    const response = await request(context.app)
      .post('/webhooks/payment-provider')
      .send(webhook)
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('Missing signature');
  });

  test('POST /webhooks with malformed payload returns 400', async () => {
    const malformedPayload: any = {
      event_id: 'evt_001',
      // missing type, subscription_id
    };

    const signature = WebhookPayloadFactory.signPayload(malformedPayload);

    const response = await request(context.app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(malformedPayload)
      .expect(400);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('Invalid payload');
  });

  test('Webhook processes payment.succeeded event correctly', async () => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_001')
      .trialing()
      .build();

    const invoice = new InvoiceBuilder()
      .withSubscriptionId(subscription.id)
      .pending()
      .build();

    await context.subscriptionRepo.save(subscription);
    await context.invoiceRepo.save(invoice);

    const webhook = WebhookPayloadFactory.createPaymentSucceeded(subscription.id, invoice.id);
    const signature = WebhookPayloadFactory.signPayload(webhook);

    await request(context.app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook)
      .expect(200);

    // Verify subscription transitioned to active
    const updated = await context.subscriptionRepo.findById(subscription.id);
    expect(updated!.status).toBe('active');
  });

  test('Webhook processes payment.failed event correctly', async () => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_001')
      .trialing()
      .build();

    const invoice = new InvoiceBuilder()
      .withSubscriptionId(subscription.id)
      .pending()
      .build();

    await context.subscriptionRepo.save(subscription);
    await context.invoiceRepo.save(invoice);

    const webhook = WebhookPayloadFactory.createPaymentFailed(subscription.id, invoice.id);
    const signature = WebhookPayloadFactory.signPayload(webhook);

    await request(context.app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook)
      .expect(200);

    // Verify subscription transitioned to past_due
    const updated = await context.subscriptionRepo.findById(subscription.id);
    expect(updated!.status).toBe('past_due');
  });

  test('Duplicate webhook is identified and not reprocessed', async () => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_001')
      .trialing()
      .build();

    const invoice = new InvoiceBuilder()
      .withSubscriptionId(subscription.id)
      .pending()
      .build();

    await context.subscriptionRepo.save(subscription);
    await context.invoiceRepo.save(invoice);

    const webhook = WebhookPayloadFactory.createPaymentSucceeded(subscription.id, invoice.id);
    const signature = WebhookPayloadFactory.signPayload(webhook);

    // Send first time
    await request(context.app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook)
      .expect(200);

    // Verify first processing
    const afterFirst = await context.subscriptionRepo.findById(subscription.id);
    expect(afterFirst!.status).toBe('active');

    // Send duplicate
    const response = await request(context.app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(webhook)
      .expect(200);

    expect(response.body.message).toContain('already processed');

    // Verify webhook events
    const events = await context.webhookEventRepo.findByEventId(webhook.event_id);
    expect(events.length).toBe(2);
    expect(events[0].is_duplicate).toBe(false);
    expect(events[1].is_duplicate).toBe(true);
  });
});
