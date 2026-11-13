import request from 'supertest';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { createServer } from '../src/service/server';
import { InMemoryRepository } from '../src/persistence/repository';
import { MockPaymentProvider } from '../src/payment/mock-payment-provider';
import { SubscriptionBuilder } from '../src/builders/subscription-builder';
import { WebhookPayloadBuilder } from '../src/builders/webhook-payload-builder';

describe('Webhook Idempotency & Duplicate Delivery', () => {
  let app: any;
  let repository: InMemoryRepository;
  let paymentProvider: MockPaymentProvider;

  beforeEach(() => {
    repository = new InMemoryRepository();
    paymentProvider = new MockPaymentProvider();
    app = createServer(repository, paymentProvider);
  });

  it('ensures duplicate webhook delivery processes exactly once and prevents duplicate invoices', async () => {
    const sub = new SubscriptionBuilder().withStatus('trialing').build();
    repository.saveSubscription(sub);

    const eventId = 'evt_duplicate_test_123';
    const payload = new WebhookPayloadBuilder()
      .withEventId(eventId)
      .withSubscriptionId(sub.id)
      .withType('payment.succeeded')
      .build();

    // First delivery
    const res1 = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', 'valid_hmac_signature')
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('processed');

    const invoicesAfterFirst = repository.getInvoicesForSubscription(sub.id);
    expect(invoicesAfterFirst.length).toBe(1);

    // Second delivery (duplicate event_id)
    const res2 = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', 'valid_hmac_signature')
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('ignored_duplicate_event');

    // Verify invoice count did not grow
    const invoicesAfterSecond = repository.getInvoicesForSubscription(sub.id);
    expect(invoicesAfterSecond.length).toBe(1);
  });
});