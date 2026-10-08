import { SubscriptionBuilder } from '../../framework/builders/subscription.builder';
import { WebhookPayloadBuilder } from '../../framework/builders/webhook-payload.builder';
import { createHarness } from '../test-harness';

describe('billing API contract and validation', () => {
  it('creates, retrieves, and cancels a subscription with a stable response shape', async () => {
    const { api, provider, service, verifier } = createHarness();
    const creation = await api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    expect(creation.statusCode).toBe(201);
    expect(creation.body).toMatchObject({ id: 'sub_1', customer_id: 'cust_001', plan: 'basic', status: 'trialing' });
    expect((creation.body as { trial_ends_at: string }).trial_ends_at).toBeTruthy();

    const retrieval = await api.getSubscription('sub_1');
    verifier.assertApiMatchesPersistence('sub_1', retrieval);
    expect(retrieval.body).toEqual(creation.body);

    const cancellation = await api.cancelSubscription('sub_1');
    expect(cancellation.statusCode).toBe(200);
    verifier.assertApiMatchesPersistence('sub_1', cancellation);
    expect((cancellation.body as { status: string }).status).toBe('canceled');
    expect((await api.cancelSubscription('sub_1')).statusCode).toBe(409);
    expect(provider.calls).toHaveLength(0);
    expect(service.invoices.all()).toHaveLength(0);
  });

  it('rejects invalid creation requests without persistence or provider calls', async () => {
    const { api, provider, service } = createHarness();
    const invalidPayloads = [
      { customer_id: 'cust_001', plan: 'unknown', payment_method_id: 'pm_valid' },
      { customer_id: 'missing-customer', plan: 'basic', payment_method_id: 'pm_valid' },
      { customer_id: 'cust_001', plan: 'basic', payment_method_id: 'invalid' },
      { customer_id: 'cust_001', plan: 'basic' },
    ];
    for (const payload of invalidPayloads) {
      const response = await api.request('POST', '/subscriptions', payload);
      expect([400, 404]).toContain(response.statusCode);
    }
    expect(service.subscriptions.all()).toHaveLength(0);
    expect(service.invoices.all()).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects an API cancellation transition not allowed from past_due', async () => {
    const { api, service } = createHarness();
    const creation = await api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    const subscriptionId = (creation.body as { id: string }).id;
    await api.postWebhook(new WebhookPayloadBuilder()
      .withEventId('evt_api_cancel_past_due')
      .ofType('payment.failed')
      .forSubscription(subscriptionId)
      .build());

    expect((await api.cancelSubscription(subscriptionId)).statusCode).toBe(409);
    expect(service.subscriptions.findById(subscriptionId)?.status).toBe('past_due');
  });

  it('rejects missing/forged signatures and malformed or invalid webhook payloads', async () => {
    const { api } = createHarness();
    const created = await api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    const subscriptionId = (created.body as { id: string }).id;
    const payload = new WebhookPayloadBuilder().forSubscription(subscriptionId).build();
    const rawBody = JSON.stringify(payload);

    expect((await api.postRawWebhook(rawBody)).statusCode).toBe(401);
    expect((await api.postRawWebhook(rawBody, '0'.repeat(64))).statusCode).toBe(401);
    expect((await api.postRawWebhook('{', api.sign('{'))).statusCode).toBe(400);
    const invalidPayload = JSON.stringify({ ...payload, amount: -1 });
    expect((await api.postRawWebhook(invalidPayload, api.sign(invalidPayload))).statusCode).toBe(400);
  });
});
