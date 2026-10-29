import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';

describe('test environment isolation (guards against stale data)', () => {
  it('does not share subscriptions or id sequences between environments', async () => {
    const envA = TestEnvironment.create();
    const envB = TestEnvironment.create();

    const created = await envA.api.createSubscription(aSubscriptionRequest().build());

    await envA.persistence.expectSubscriptionCount(1);
    await envB.persistence.expectNoSubscriptions();
    expect((await envB.api.getSubscription(created.body.id)).status).toBe(404);

    const inB = await envB.api.createSubscription(aSubscriptionRequest().build());
    expect(inB.body.id).toBe(created.body.id); // ids restart per environment
  });
});
