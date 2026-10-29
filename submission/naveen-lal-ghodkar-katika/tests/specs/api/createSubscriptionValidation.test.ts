import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';

describe('POST /subscriptions - invalid requests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe.each(['customer_id', 'plan', 'payment_method_id'])('missing %s', (field) => {
    it('is rejected with 400 validation_error and persists nothing', async () => {
      const res = await env.api.createSubscription(aSubscriptionRequest().without(field).build());

      BillingAssertions.expectError(res, 400, 'validation_error');
      expect(res.body.error.message).toContain(field);
      await env.persistence.expectNoSubscriptions();
    });
  });

  it.each([
    ['customer_id', 123],
    ['plan', null],
    ['payment_method_id', ['pm_test_visa_4242']],
    ['customer_id', ''],
  ])('rejects a non-string or empty %s (%p) with 400', async (field, value) => {
    const res = await env.api.createSubscription(aSubscriptionRequest().with(field, value).build());

    BillingAssertions.expectError(res, 400, 'validation_error');
    await env.persistence.expectNoSubscriptions();
  });

  it('rejects a request with no body with 400', async () => {
    const res = await env.api.createSubscription();

    BillingAssertions.expectError(res, 400, 'validation_error');
    await env.persistence.expectNoSubscriptions();
  });

  it('rejects malformed JSON with 400 and persists nothing', async () => {
    const res = await env.api.createSubscriptionRaw('{"customer_id": "cust_001", ');

    BillingAssertions.expectError(res, 400, 'malformed_json');
    await env.persistence.expectNoSubscriptions();
  });

  it.each(['enterprise', 'PRO', 'constructor', '__proto__'])(
    'rejects unknown plan %p with 422 invalid_plan',
    async (plan) => {
      const res = await env.api.createSubscription(aSubscriptionRequest().onPlan(plan).build());

      BillingAssertions.expectError(res, 422, 'invalid_plan');
      await env.persistence.expectNoSubscriptions();
    },
  );

  it('rejects an unknown customer with 422 customer_not_found', async () => {
    const res = await env.api.createSubscription(aSubscriptionRequest().forCustomer('cust_999').build());

    BillingAssertions.expectError(res, 422, 'customer_not_found');
    await env.persistence.expectNoSubscriptions();
  });

  it.each(['visa_4242', 'pm_', 'pm test', 'PM_test'])(
    'rejects malformed payment method id %p with 422 invalid_payment_method',
    async (paymentMethodId) => {
      const res = await env.api.createSubscription(
        aSubscriptionRequest().withPaymentMethod(paymentMethodId).build(),
      );

      BillingAssertions.expectError(res, 422, 'invalid_payment_method');
      await env.persistence.expectNoSubscriptions();
    },
  );

  // "Rejected creation never calls the payment provider" lives in specs/provider/rejectedRequests.test.ts.
});
