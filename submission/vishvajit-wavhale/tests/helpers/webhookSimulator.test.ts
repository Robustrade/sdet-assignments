
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { createTestContext } from '../fixtures/testContext.js';
import { WebhookSimulator } from './WebhookSimulator.js';
import { WebhookBuilder } from '../builders/WebhookBuilder.js';

describe('WebhookSimulator', () => {
  let context: ReturnType<typeof createTestContext>;
  let simulator: WebhookSimulator;

  beforeEach(() => {
    context = createTestContext();

    simulator = new WebhookSimulator(
      context.app,
      context.webhookSecret
    );
  });

  afterEach(() => {
    context.cleanup();
  });

  it('should reject a webhook with an invalid signature', async () => {
    const webhook = new WebhookBuilder().build();

    const response = await simulator.sendInvalidSignature(webhook);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('should reject malformed JSON with a valid signature', async () => {
    const response = await simulator.sendMalformedPayload(
      '{invalid-json'
    );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should reject a validly signed webhook referencing a nonexistent invoice', async () => {
    // Create a real subscription to satisfy the webhook_events foreign key.
    const createResponse = await simulator['app']
      ? await import('supertest').then(({ default: request }) =>
          request(context.app)
            .post('/subscriptions')
            .send({
              customerId: 'cust_001',
              planId: 'plan_basic',
              paymentMethodId: 'pm_test_001'
            })
        )
      : null;

    expect(createResponse?.status).toBe(201);

    const subscriptionId = createResponse!.body.data.id;

    // Keep the subscription valid but use a nonexistent invoice.
    const webhook = new WebhookBuilder()
      .withInvoiceId('inv_does_not_exist')
      .withSubscriptionId(subscriptionId)
      .build();

    const response = await simulator.send(webhook);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.data.status).toBe('invalid');
  });
});
