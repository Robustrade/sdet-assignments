import { useHarness } from '../framework/useHarness';
import { expectError } from '../framework/verify/expectations';

describe('GET /subscriptions/:id', () => {
  const env = useHarness();

  it('returns exactly what is stored', async () => {
    const { subscriptionId } = await env().given.active();

    expect(await env().apiVsDbDifferences(subscriptionId)).toEqual([]);
  });

  it('unknown id -> 404 not_found', async () => {
    expectError(await env().api.get('sub_9999'), 404, 'not_found');
  });
});

describe('POST /subscriptions/:id/cancel', () => {
  const env = useHarness();

  it('trialing -> canceled: 200, canceled_at set, audited, no charge', async () => {
    const { subscriptionId } = await env().given.trialing();
    env().clock.advanceDays(3);

    const response = await env().api.cancel(subscriptionId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'canceled', canceled_at: env().clock.now(), cancel_reason: 'customer_request' });
    const stored = env().stored(subscriptionId);
    expect(stored.statusHistory()).toEqual(['trialing', 'canceled']);
    expect(stored.audit.at(-1)).toMatchObject({ source: 'api', fromStatus: 'trialing', toStatus: 'canceled' });
    expect(env().gateway.calls).toHaveLength(0);
  });

  it('active -> canceled: the paid invoice stays paid (cancel is not a refund)', async () => {
    const { subscriptionId, invoiceId } = await env().given.active();

    await env().api.cancel(subscriptionId);

    expect(env().repos.invoices.findById(invoiceId)?.status).toBe('paid');
  });

  it('canceling an already-canceled subscription -> 409 and nothing changes', async () => {
    const { subscriptionId } = await env().given.canceled();
    const dbBefore = env().snapshot();

    const response = await env().api.cancel(subscriptionId);

    const error = expectError(response, 409, 'invalid_transition');
    expect(error.details).toEqual({ current_status: 'canceled' });
    expect(env().tablesChangedSince(dbBefore)).toEqual([]);
  });

  it('past_due cannot be canceled through the API (not a transition in the lifecycle) -> 409', async () => {
    const { subscriptionId } = await env().given.pastDue();
    const dbBefore = env().snapshot();

    const response = await env().api.cancel(subscriptionId);

    expectError(response, 409, 'invalid_transition');
    expect(env().stored(subscriptionId).status).toBe('past_due');
    expect(env().tablesChangedSince(dbBefore)).toEqual([]);
  });
});
