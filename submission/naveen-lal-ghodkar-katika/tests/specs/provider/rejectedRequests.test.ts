import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';

/**
 * A rejected request must never reach the payment provider. Every case below would be a valid
 * basic-plan charge if it were not for the single deviation, so a validation gap would show
 * up as an unexpected provider call.
 */
describe('rejected requests never call the payment provider', () => {
  let env: TestEnvironment;

  const validBasic = () => aSubscriptionRequest().onPlan('basic');

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  it.each(['customer_id', 'plan', 'payment_method_id'])('missing %s', async (field) => {
    const res = await env.api.createSubscription(validBasic().without(field).build());

    expect(res.status).toBe(400);
    env.providerCalls.expectNoCharges();
    await env.persistence.expectNoSubscriptions();
  });

  it('unknown plan', async () => {
    const res = await env.api.createSubscription(validBasic().onPlan('enterprise').build());

    expect(res.status).toBe(422);
    env.providerCalls.expectNoCharges();
    await env.persistence.expectNoSubscriptions();
  });

  it('unknown customer', async () => {
    const res = await env.api.createSubscription(validBasic().forCustomer('cust_999').build());

    expect(res.status).toBe(422);
    env.providerCalls.expectNoCharges();
    await env.persistence.expectNoSubscriptions();
  });

  it('malformed payment method id', async () => {
    const res = await env.api.createSubscription(validBasic().withPaymentMethod('visa_4242').build());

    expect(res.status).toBe(422);
    env.providerCalls.expectNoCharges();
    await env.persistence.expectNoSubscriptions();
  });

  it('malformed JSON body', async () => {
    const res = await env.api.createSubscriptionRaw('{"customer_id": "cust_001", "plan": "basic", ');

    expect(res.status).toBe(400);
    env.providerCalls.expectNoCharges();
    await env.persistence.expectNoSubscriptions();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['over 255 characters', 'k'.repeat(256)],
  ])('%s Idempotency-Key header', async (_name, idempotencyKey) => {
    const res = await env.api.createSubscription(validBasic().build(), { idempotencyKey });

    expect(res.status).toBe(400);
    env.providerCalls.expectNoCharges();
    await env.persistence.expectNoSubscriptions();
  });

  it('cancel of an unknown subscription', async () => {
    const res = await env.api.cancelSubscription('sub_does_not_exist');

    expect(res.status).toBe(404);
    env.providerCalls.expectNoCharges();
  });

  it('a rejected request does not disturb a later valid one', async () => {
    await env.api.createSubscription(validBasic().onPlan('enterprise').build());

    const res = await env.api.createSubscription(validBasic().build());

    expect(res.status).toBe(201);
    env.providerCalls.expectCallCount(1);
  });
});
