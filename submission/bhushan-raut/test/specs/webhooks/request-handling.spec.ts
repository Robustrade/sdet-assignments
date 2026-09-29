import { describe, expect, it } from 'vitest';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment, type TestEnvironment } from '../../framework/env/TestEnvironment';
import type { WebhookDelivery } from '../../framework/doubles/WebhookSimulator';
import type { WithPendingCharge } from '../../framework/env/Given';

/**
 * Transport-level handling, kept separate from webhook business logic. Every case
 * starts from a subscription with a charge in flight, so a wrongly accepted event
 * WOULD have visible effects — "nothing persisted" is then a meaningful assertion.
 */
describe('Webhook endpoint rejects unauthenticated or malformed requests', () => {
  const env = useTestEnvironment();

  async function expectRejectedWithoutSideEffects(
    world: WithPendingCharge,
    delivery: (env: TestEnvironment, payload: Record<string, unknown>) => WebhookDelivery,
    expected: { status: number; code: string },
  ) {
    const payload = aWebhook().paymentSucceeded().forCharge(world.charge).build();
    const before = env().db.snapshotCounts();

    const res = await env().webhooks.deliver(delivery(env(), payload));

    expect(res.status).toBe(expected.status);
    expect(res.body.error?.code).toBe(expected.code);
    expect(env().db.snapshotCounts(), 'nothing persisted, not even the event').toEqual(before);
    expect((await env().assert.expectConsistent(world.subscription.id)).status).toBe('trialing');
    expect(env().notifier.activationsFor(world.subscription.id)).toBe(0);
  }

  it('F1: missing signature -> 401', async () => {
    const world = await env().given.subscriptionWithPendingFirstCharge();
    await expectRejectedWithoutSideEffects(world, (e, p) => e.simulator.unsigned(p), {
      status: 401,
      code: 'invalid_signature',
    });
  });

  it('F1: signature made with the wrong secret (forged) -> 401', async () => {
    const world = await env().given.subscriptionWithPendingFirstCharge();
    await expectRejectedWithoutSideEffects(world, (e, p) => e.simulator.signedWithWrongSecret(p), {
      status: 401,
      code: 'invalid_signature',
    });
  });

  it('F2: body altered after signing (amount inflated) -> 401', async () => {
    const world = await env().given.subscriptionWithPendingFirstCharge();
    await expectRejectedWithoutSideEffects(
      world,
      (e, p) => e.simulator.tamperedAfterSigning(p, (body) => (body.amount = 999_999)),
      { status: 401, code: 'invalid_signature' },
    );
  });

  it('F3: correctly signed but not JSON -> 400', async () => {
    const world = await env().given.subscriptionWithPendingFirstCharge();
    await expectRejectedWithoutSideEffects(world, (e) => e.simulator.signedRaw('{"event_id": "evt_'), {
      status: 400,
      code: 'malformed_payload',
    });
  });

  it.each(['event_id', 'type', 'subscription_id', 'invoice_id', 'amount', 'currency'])(
    'F3: correctly signed but missing %s -> 400',
    async (field) => {
      const world = await env().given.subscriptionWithPendingFirstCharge();
      await expectRejectedWithoutSideEffects(
        world,
        (e, p) => {
          delete p[field];
          return e.simulator.signed(p);
        },
        { status: 400, code: 'malformed_payload' },
      );
    },
  );

  it('F3: correctly signed but unknown event type -> 400', async () => {
    const world = await env().given.subscriptionWithPendingFirstCharge();
    await expectRejectedWithoutSideEffects(
      world,
      (e, p) => e.simulator.signed({ ...p, type: 'payment.teleported' }),
      { status: 400, code: 'malformed_payload' },
    );
  });
});
