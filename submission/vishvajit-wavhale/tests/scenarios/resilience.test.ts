
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { createTestContext } from '../fixtures/testContext.js';
import { WebhookSimulator } from '../helpers/WebhookSimulator.js';
import { WebhookBuilder } from '../builders/WebhookBuilder.js';
import { DatabaseAssertions } from '../helpers/DatabaseAssertions.js';

describe('Subscription Resilience Scenarios', () => {
  let context: ReturnType<typeof createTestContext>;
  let webhookSimulator: WebhookSimulator;
  let databaseAssertions: DatabaseAssertions;

  beforeEach(() => {
    context = createTestContext();

    webhookSimulator = new WebhookSimulator(
      context.app,
      context.webhookSecret
    );

    databaseAssertions = new DatabaseAssertions(
      context.database.connection
    );
  });

  afterEach(() => {
    context.cleanup();
  });

  async function createSubscription(
    id = 'sub_resilience_001'
  ): Promise<string> {
    const subscription =
      context.services.subscriptionService.createSubscription({
        id,
        customerId: 'cust_001',
        planId: 'plan_basic',
        paymentMethodId: 'pm_test_001'
      });

    return subscription.id;
  }

  function createInvoice(
    invoiceId: string,
    subscriptionId: string
  ) {
    return context.repositories.invoiceRepository.create({
      id: invoiceId,
      subscription_id: subscriptionId,
      amount: 1900,
      currency: 'USD'
    });
  }

  it('should ignore duplicate webhook delivery', async () => {
    const subscriptionId = await createSubscription();

    const invoice = createInvoice(
      'inv_duplicate_001',
      subscriptionId
    );

    const webhook = new WebhookBuilder()
      .withEventId('evt_duplicate_001')
      .withInvoiceId(invoice.id)
      .withSubscriptionId(subscriptionId)
      .asSucceeded()
      .build();

    const firstResponse = await webhookSimulator.send(webhook);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.data.status).toBe('processed');

    const secondResponse = await webhookSimulator.send(webhook);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.data.status).toBe('duplicate');

    databaseAssertions.assertRecordCount('webhook_events', 1);

    databaseAssertions.assertColumnValue(
      'subscriptions',
      'id',
      subscriptionId,
      'status',
      'active'
    );
  });

  it('should reject reactivation of a canceled subscription', async () => {
    const subscriptionId = await createSubscription();

    context.services.subscriptionService.cancelSubscription(
      subscriptionId
    );

    expect(() => {
      context.services.subscriptionService.applyEvent(
        subscriptionId,
        'PAYMENT_SUCCEEDED',
        'E2E_TEST'
      );
    }).toThrow();

    databaseAssertions.assertColumnValue(
      'subscriptions',
      'id',
      subscriptionId,
      'status',
      'canceled'
    );
  });

  it('should ignore a stale failure webhook for an already successful invoice', async () => {
    const subscriptionId = await createSubscription();

    const invoice = createInvoice(
      'inv_stale_001',
      subscriptionId
    );

    const successWebhook = new WebhookBuilder()
      .withEventId('evt_success_001')
      .withInvoiceId(invoice.id)
      .withSubscriptionId(subscriptionId)
      .asSucceeded()
      .build();

    const successResponse = await webhookSimulator.send(
      successWebhook
    );

    expect(successResponse.status).toBe(200);
    expect(successResponse.body.data.status).toBe('processed');

    const failureWebhook = new WebhookBuilder()
      .withEventId('evt_failure_001')
      .withInvoiceId(invoice.id)
      .withSubscriptionId(subscriptionId)
      .asFailed()
      .build();

    const failureResponse = await webhookSimulator.send(
      failureWebhook
    );

    expect(failureResponse.status).toBe(200);
    expect(failureResponse.body.data.status).toBe('ignored');

    databaseAssertions.assertColumnValue(
      'invoices',
      'id',
      invoice.id,
      'status',
      'succeeded'
    );

    databaseAssertions.assertColumnValue(
      'subscriptions',
      'id',
      subscriptionId,
      'status',
      'active'
    );
  });

  it('should keep invoice pending and subscription unchanged after payment timeout', async () => {
    const subscriptionId = await createSubscription();

    context.paymentProvider.queueResult({
      status: 'timeout',
      reason: 'Payment provider timeout'
    });

    const result = await context.services.subscriptionService.processPayment(
      subscriptionId,
      'inv_timeout_001'
    );

    expect(result.paymentResult.status).toBe('timeout');
    expect(result.invoice?.status).toBe('pending');
    expect(result.subscription.status).toBe('trialing');

    expect(context.paymentProvider.getCallCount()).toBe(1);

    databaseAssertions.assertColumnValue(
      'invoices',
      'id',
      'inv_timeout_001',
      'status',
      'pending'
    );

    databaseAssertions.assertColumnValue(
      'subscriptions',
      'id',
      subscriptionId,
      'status',
      'trialing'
    );
  });

  it('should cancel a past_due subscription when retries are exhausted', async () => {
    const subscriptionId = await createSubscription();

    context.services.subscriptionService.applyEvent(
      subscriptionId,
      'PAYMENT_FAILED',
      'E2E_TEST'
    );

    const pastDueSubscription =
      context.services.subscriptionService.getSubscription(
        subscriptionId
      );

    expect(pastDueSubscription?.status).toBe('past_due');

    context.services.subscriptionService.applyEvent(
      subscriptionId,
      'RETRIES_EXHAUSTED',
      'RETRY_WORKER'
    );

    const canceledSubscription =
      context.services.subscriptionService.getSubscription(
        subscriptionId
      );

    expect(canceledSubscription?.status).toBe('canceled');

    databaseAssertions.assertColumnValue(
      'subscriptions',
      'id',
      subscriptionId,
      'status',
      'canceled'
    );
  });

  it('should preserve past_due state when another payment fails', async () => {
    const subscriptionId = await createSubscription();

    context.services.subscriptionService.applyEvent(
      subscriptionId,
      'PAYMENT_FAILED',
      'E2E_TEST'
    );

    const invoice = createInvoice(
      'inv_second_failure_001',
      subscriptionId
    );

    const webhook = new WebhookBuilder()
      .withEventId('evt_second_failure_001')
      .withInvoiceId(invoice.id)
      .withSubscriptionId(subscriptionId)
      .asFailed()
      .build();

    const response = await webhookSimulator.send(webhook);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('processed');

    databaseAssertions.assertColumnValue(
      'subscriptions',
      'id',
      subscriptionId,
      'status',
      'past_due'
    );

    databaseAssertions.assertColumnValue(
      'invoices',
      'id',
      invoice.id,
      'status',
      'failed'
    );
  });
});
