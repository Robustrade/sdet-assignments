
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { ApiClient } from './ApiClient.js';
import { createTestContext } from '../fixtures/testContext.js';

describe('ApiClient', () => {
  let context: ReturnType<typeof createTestContext>;
  let apiClient: ApiClient;

  beforeEach(() => {
    context = createTestContext();
    apiClient = new ApiClient(context.app);
  });

  afterEach(() => {
    context.cleanup();
  });

  it('should execute GET requests', async () => {
    const response = await apiClient.get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should execute POST requests with a JSON body', async () => {
    const response = await apiClient.post('/subscriptions', {
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_001'
    });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('trialing');
  });

  it('should support custom request headers', async () => {
    const response = await apiClient.post(
      '/webhooks/payment-provider',
      JSON.stringify({
        event_id: 'evt_test_001'
      }),
      {
        'Content-Type': 'application/json',
        'x-webhook-signature': 'invalid-signature'
      }
    );

    expect(response.status).toBe(401);
  });
});
