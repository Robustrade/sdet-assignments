import type { SubscriptionStatus } from '../../../src/domain/Subscription';
import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aSubscriptionRecord } from '../../framework/builders/SubscriptionRecordBuilder';

/**
 * Cancellation through the real HTTP -> service -> state machine path, from every starting state.
 * Rows are seeded through the repository (arrange only); the cancel call is the behavior under test.
 */
describe('POST /subscriptions/{id}/cancel by starting state', () => {
  let env: TestEnvironment;
  const seed = async (status: SubscriptionStatus) => {
    const record = aSubscriptionRecord().inStatus(status).build();
    await env.subscriptions.save(record);
    return record;
  };

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe.each(['trialing', 'active'] as const)('from %s (valid)', (status) => {
    it('cancels: 200, canceled in the response and in the stored row', async () => {
      const seeded = await seed(status);

      const res = await env.api.cancelSubscription(seeded.id);

      expect(res.status).toBe(200);
      BillingAssertions.expectSubscriptionShape(res.body);
      expect(res.body.status).toBe('canceled');
      await env.persistence.expectSubscriptionMatchesApi(res.body);
      await env.persistence.expectSubscriptionCount(1);
    });

    it('is irreversible: a second cancel is rejected and the subscription stays canceled', async () => {
      const seeded = await seed(status);
      await env.api.cancelSubscription(seeded.id);

      const second = await env.api.cancelSubscription(seeded.id);

      BillingAssertions.expectError(second, 409, 'invalid_transition');
      expect((await env.api.getSubscription(seeded.id)).body.status).toBe('canceled');
    });
  });

  describe.each(['past_due', 'canceled'] as const)('from %s (invalid)', (status) => {
    it('is rejected with 409 invalid_transition and the stored row is untouched', async () => {
      const seeded = await seed(status);

      const res = await env.api.cancelSubscription(seeded.id);

      BillingAssertions.expectError(res, 409, 'invalid_transition');
      expect(await env.subscriptions.findById(seeded.id)).toEqual(seeded);
      expect((await env.api.getSubscription(seeded.id)).body.status).toBe(status);
    });
  });

  it('does not touch other subscriptions when a rejected cancel happens', async () => {
    const pastDue = await seed('past_due');
    const bystander = aSubscriptionRecord().withId('sub_seed_002').inStatus('active').build();
    await env.subscriptions.save(bystander);

    await env.api.cancelSubscription(pastDue.id);

    expect(await env.subscriptions.findById(bystander.id)).toEqual(bystander);
    await env.persistence.expectSubscriptionCount(2);
  });
});
