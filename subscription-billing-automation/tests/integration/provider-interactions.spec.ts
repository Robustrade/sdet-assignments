import { SubscriptionBuilder } from '../../framework/builders/subscription.builder';
import { createHarness } from '../test-harness';

describe('mock payment provider interactions', () => {
  it('charges immediate plans once with the expected customer, method, amount, and reference', async () => {
    const { api, provider, service, verifier } = createHarness();
    provider.setOutcome({ kind: 'succeeded', providerReference: 'ch_pro_1' });

    const response = await api.createSubscription(new SubscriptionBuilder().onPlan('pro').buildCreatePayload());
    const subscriptionId = (response.body as { id: string; status: string }).id;

    expect(response.statusCode).toBe(201);
    expect((response.body as { status: string }).status).toBe('active');
    expect(provider.calls).toEqual([{
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amount: 4900,
      currency: 'USD',
      idempotencyKey: `initial-charge:${subscriptionId}`,
    }]);
    expect(service.invoices.findBySubscriptionId(subscriptionId)).toEqual([
      expect.objectContaining({ amount: 4900, status: 'succeeded', providerReference: 'ch_pro_1' }),
    ]);
    verifier.assertApiMatchesPersistence(subscriptionId, response);
    verifier.assertActiveHasSuccessfulPayment(subscriptionId);
  });

  it.each([
    [{ kind: 'declined', reason: 'card_declined' } as const, 'past_due', 'failed'],
    [{ kind: 'timeout' } as const, 'past_due', 'pending'],
  ])('persists and exposes a %s provider result', async (outcome, expectedState, expectedInvoice) => {
    const { api, provider, service, verifier } = createHarness();
    provider.setOutcome(outcome);

    const response = await api.createSubscription(new SubscriptionBuilder().onPlan('pro').buildCreatePayload());
    const subscriptionId = (response.body as { id: string }).id;

    expect((response.body as { status: string }).status).toBe(expectedState);
    expect(provider.calls).toHaveLength(1);
    expect(service.invoices.findBySubscriptionId(subscriptionId)).toEqual([
      expect.objectContaining({ status: expectedInvoice, amount: 4900 }),
    ]);
    verifier.assertApiMatchesPersistence(subscriptionId, response);
  });

  it('does not call the provider for trial creation or rejected requests', async () => {
    const { api, provider } = createHarness();
    await api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    await api.createSubscription({
      customer_id: 'cust_001',
      plan: 'unavailable',
      payment_method_id: 'pm_test_visa_4242',
    });
    expect(provider.calls).toHaveLength(0);
  });
});
