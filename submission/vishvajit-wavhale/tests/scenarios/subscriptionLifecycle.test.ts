
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { createTestContext } from '../fixtures/testContext.js';
import { ApiClient } from '../clients/ApiClient.js';
import { SubscriptionBuilder } from '../builders/SubscriptionBuilder.js';
import { WebhookSimulator } from '../helpers/WebhookSimulator.js';
import { ApiAssertions } from '../helpers/ApiAssertions.js';
import { DatabaseAssertions } from '../helpers/DatabaseAssertions.js';

describe('Subscription Lifecycle E2E Scenarios', () => {
  let context: ReturnType<typeof createTestContext>;
  let api: ApiClient;
  let webhookSimulator: WebhookSimulator;
  let databaseAssertions: DatabaseAssertions;

  beforeEach(() => {
    context = createTestContext();

    api = new ApiClient(context.app);

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

  async function createSubscription(): Promise<string> {
    const subscriptionData = new SubscriptionBuilder().build();

    const response = await api.post(
      '/subscriptions',
      {
        customerId: subscriptionData.customerId,
        planId: subscriptionData.planId,
        paymentMethodId: subscriptionData.paymentMethodId
      }
    );

    ApiAssertions.assertSuccess(response, 201);

    return response.body.data.id as string;
  }

  it('should create a subscription in trialing state', async () => {
    const subscriptionId = await createSubscription();

    const response = await api.get(
      `/subscriptions/${subscriptionId}`
    );

    ApiAssertions.assertSuccess(response);
    ApiAssertions.assertSubscriptionStatus(response, 'trialing');

    databaseAssertions.assertRecordExists(
      'subscriptions',
      'id',
      subscriptionId
    );
  });

  it('should activate a trialing subscription after successful payment', async () => {
    const subscriptionId = await createSubscription();

    const invoice = context.repositories.invoiceRepository.create({
      id: `inv_${subscriptionId}`,
      subscription_id: subscriptionId,
      amount: 1900,
      currency: 'USD'
    });

    const webhookResponse = await webhookSimulator.sendSuccessfulPayment(
      invoice.id,
      subscriptionId
    );

    expect(webhookResponse.status).toBe(200);

    const response = await api.get(
      `/subscriptions/${subscriptionId}`
    );

    ApiAssertions.assertSuccess(response);
    ApiAssertions.assertSubscriptionStatus(response, 'active');

    databaseAssertions.assertColumnValue(
      'invoices',
      'id',
      invoice.id,
      'status',
      'succeeded'
    );
  });

  it('should move a trialing subscription to past_due after failed payment', async () => {
    const subscriptionId = await createSubscription();

    const invoice = context.repositories.invoiceRepository.create({
      id: `inv_${subscriptionId}`,
      subscription_id: subscriptionId,
      amount: 1900,
      currency: 'USD'
    });

    const webhookResponse = await webhookSimulator.sendFailedPayment(
      invoice.id,
      subscriptionId,
      'Insufficient funds'
    );

    expect(webhookResponse.status).toBe(200);

    const response = await api.get(
      `/subscriptions/${subscriptionId}`
    );

    ApiAssertions.assertSuccess(response);
    ApiAssertions.assertSubscriptionStatus(response, 'past_due');

    databaseAssertions.assertColumnValue(
      'invoices',
      'id',
      invoice.id,
      'status',
      'failed'
    );
  });

  it('should allow a past_due subscription to recover after successful retry', async () => {
    const subscriptionId = await createSubscription();

    const firstInvoice = context.repositories.invoiceRepository.create({
      id: `inv_first_${subscriptionId}`,
      subscription_id: subscriptionId,
      amount: 1900,
      currency: 'USD'
    });

    const failedResponse = await webhookSimulator.sendFailedPayment(
      firstInvoice.id,
      subscriptionId
    );

    expect(failedResponse.status).toBe(200);

    const secondInvoice = context.repositories.invoiceRepository.create({
      id: `inv_retry_${subscriptionId}`,
      subscription_id: subscriptionId,
      amount: 1900,
      currency: 'USD'
    });

    const successResponse = await webhookSimulator.sendSuccessfulPayment(
      secondInvoice.id,
      subscriptionId
    );

    expect(successResponse.status).toBe(200);

    const response = await api.get(
      `/subscriptions/${subscriptionId}`
    );

    ApiAssertions.assertSuccess(response);
    ApiAssertions.assertSubscriptionStatus(response, 'active');

    databaseAssertions.assertColumnValue(
      'invoices',
      'id',
      firstInvoice.id,
      'status',
      'failed'
    );

    databaseAssertions.assertColumnValue(
      'invoices',
      'id',
      secondInvoice.id,
      'status',
      'succeeded'
    );
  });

  it('should cancel an active subscription through the API', async () => {
    const subscriptionId = await createSubscription();

    await context.services.subscriptionService.applyEvent(
  subscriptionId,
  'PAYMENT_SUCCEEDED',
  'E2E_TEST'
);

    const cancelResponse = await api.post(
      `/subscriptions/${subscriptionId}/cancel`
    );

    ApiAssertions.assertSuccess(cancelResponse);

    const response = await api.get(
      `/subscriptions/${subscriptionId}`
    );

    ApiAssertions.assertSuccess(response);
    ApiAssertions.assertSubscriptionStatus(response, 'canceled');
  });

  it('should reject cancellation of an already canceled subscription', async () => {
    const subscriptionId = await createSubscription();

    await context.services.subscriptionService.cancelSubscription(
      subscriptionId
    );

    const response = await api.post(
      `/subscriptions/${subscriptionId}/cancel`
    );

    expect(response.status).toBe(409);
  });
});
