import { expectApiMatchesDb, expectNoDatabaseChanges } from '../support/assertions/expectations';
import { givenActiveSubscription, givenCanceledSubscription, givenPastDueSubscription, givenTrialingSubscription } from '../support/fixtures/given';
import { useTestEnvironment } from '../support/fixtures/test-environment';

describe('GET /subscriptions/{id}', () => {
  const env = useTestEnvironment();

  test('API-08 returns the subscription exactly as persisted, and GET does not mutate', async () => {
    const sub = await givenActiveSubscription(env);
    const before = env.repos.snapshots.snapshot();

    await expectApiMatchesDb(env, sub.id);
    expectNoDatabaseChanges(env, before);
  });

  test('API-09 unknown subscription -> 404', async () => {
    const res = await env.api.get('sub_missing');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });
});

describe('POST /subscriptions/{id}/cancel', () => {
  const env = useTestEnvironment();

  test('API-10 cancel active: 200 canceled, timestamp, open invoices void, audit row, no provider call', async () => {
    const sub = await givenActiveSubscription(env);
    const callsBefore = env.provider.callCount;
    env.clock.advanceDays(3);

    const res = await env.api.cancel(sub.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: sub.id, status: 'canceled', canceled_at: '2026-01-04T09:00:00.000Z' });
    await expectApiMatchesDb(env, sub.id);
    expect(env.auditOf(sub.id).at(-1)).toMatchObject({ previousStatus: 'active', newStatus: 'canceled', trigger: 'api_cancel' });
    expect(env.provider.callCount).toBe(callsBefore);
  });

  test('API-11 cancel trialing: 200 canceled', async () => {
    const sub = await givenTrialingSubscription(env);
    const res = await env.api.cancel(sub.id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');
    expect(env.auditTrail(sub.id)).toEqual(['none->trialing', 'trialing->canceled']);
    expect(env.provider.callCount).toBe(0);
  });

  test('API-12 cancel an already canceled subscription -> 409, state and audit unchanged', async () => {
    const sub = await givenCanceledSubscription(env);
    const before = env.repos.snapshots.snapshot();

    const res = await env.api.cancel(sub.id);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('INVALID_TRANSITION');
    expectNoDatabaseChanges(env, before);
  });

  test('API-13 cancel past_due -> 409 (cancel is only listed from trialing/active, assumption A-07)', async () => {
    const sub = await givenPastDueSubscription(env);
    const before = env.repos.snapshots.snapshot();

    const res = await env.api.cancel(sub.id);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('INVALID_TRANSITION');
    expectNoDatabaseChanges(env, before);
  });

  test('API-14 cancel unknown subscription -> 404', async () => {
    const res = await env.api.cancel('sub_missing');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });
});
