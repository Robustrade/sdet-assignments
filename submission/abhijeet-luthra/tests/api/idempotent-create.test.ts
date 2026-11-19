import { aSubscriptionRequest } from '../support/builders/subscription-request-builder';
import { expectNoDatabaseChanges } from '../support/assertions/expectations';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/** DUP-01..05: duplicate POST /subscriptions protection via Idempotency-Key (API_CONTRACTS §3.1). */
describe('Duplicate subscription-creation requests (Idempotency-Key)', () => {
  const env = useTestEnvironment();
  const basic = () => aSubscriptionRequest().onPlan('basic').build();

  test('DUP-01 same key + same payload (immediate plan): one subscription, one invoice, one payment, ONE provider call', async () => {
    env.provider.willSucceed();
    const first = await env.api.create(basic(), { idempotencyKey: 'key-dup-01' });
    const replay = await env.api.create(basic(), { idempotencyKey: 'key-dup-01' });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(env.repos.subscriptions.findAll()).toHaveLength(1);
    expect(env.invoicesOf(first.body.id)).toHaveLength(1);
    expect(env.paymentsOf(first.body.id)).toHaveLength(1);
    expect(env.provider.callCount).toBe(1);
    expect(env.repos.idempotencyKeys.findByKey('key-dup-01')?.subscriptionId).toBe(first.body.id);
  });

  test('DUP-02 same key + same payload (trial plan): same subscription, still trialing, no provider call', async () => {
    const request = aSubscriptionRequest().onPlan('pro').build();
    const first = await env.api.create(request, { idempotencyKey: 'key-dup-02' });
    const replay = await env.api.create(request, { idempotencyKey: 'key-dup-02' });

    expect(replay.body).toEqual(first.body);
    expect(env.repos.subscriptions.findAll()).toHaveLength(1);
    expect(env.provider.callCount).toBe(0);
  });

  test('DUP-03 same key + DIFFERENT payload -> 422 IDEMPOTENCY_KEY_REUSED, nothing written, no provider call', async () => {
    await env.api.create(basic(), { idempotencyKey: 'key-dup-03' });
    const before = env.repos.snapshots.snapshot();
    const callsBefore = env.provider.callCount;

    const res = await env.api.create(aSubscriptionRequest().onPlan('pro').build(), { idempotencyKey: 'key-dup-03' });

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expectNoDatabaseChanges(env, before);
    expect(env.provider.callCount).toBe(callsBefore);
  });

  test('DUP-04 provider timed out, client retries with the same key: original returned, NO second charge', async () => {
    env.provider.willTimeout();
    const first = await env.api.create(basic(), { idempotencyKey: 'key-dup-04' });
    expect(first.body.status).toBe('trialing'); // unknown outcome: not active, not past_due

    const retry = await env.api.create(basic(), { idempotencyKey: 'key-dup-04' });

    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(env.paymentsOf(first.body.id)).toEqual([expect.objectContaining({ attemptNumber: 1, status: 'timed_out' })]);
    expect(env.provider.callCount).toBe(1);
  });

  test('DUP-05 control: different keys with the same payload create two subscriptions', async () => {
    const a = await env.api.create(basic(), { idempotencyKey: 'key-a' });
    const b = await env.api.create(basic(), { idempotencyKey: 'key-b' });

    expect(a.body.id).not.toBe(b.body.id);
    expect(env.repos.subscriptions.findAll()).toHaveLength(2);
    expect(env.provider.callCount).toBe(2);
  });

  test('a rejected request does not consume the key: corrected retry with the same key succeeds', async () => {
    const bad = await env.api.create(aSubscriptionRequest().onPlan('enterprise').build(), { idempotencyKey: 'key-fix' });
    expect(bad.status).toBe(422);
    expect(env.repos.idempotencyKeys.findByKey('key-fix')).toBeUndefined();

    const good = await env.api.create(aSubscriptionRequest().onPlan('pro').build(), { idempotencyKey: 'key-fix' });
    expect(good.status).toBe(201);
  });

  test('an empty Idempotency-Key header is rejected with 400', async () => {
    const res = await env.api.create(basic(), { idempotencyKey: '' });
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.[0].field).toBe('Idempotency-Key');
  });
});
