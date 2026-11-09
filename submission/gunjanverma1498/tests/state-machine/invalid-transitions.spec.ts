import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionStateMachine } from '../../src/domain/stateMachine';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

const ctx = { failedChargeCount: 0, maxRetries: 3 };

/**
 * Proves that illegal transitions cannot happen. `canceled` is the terminal
 * state, so every subsequent event must be ignored — no reactivation, no
 * regression, no new side effects.
 */
describe('state machine: invalid transitions are impossible', () => {
  const machine = new SubscriptionStateMachine();

  it('canceled + CHARGE_SUCCEEDED does not reactivate (unit)', () => {
    const result = machine.apply('canceled', 'CHARGE_SUCCEEDED', ctx);
    expect(result.toStatus).toBe('canceled');
    expect(result.changed).toBe(false);
    expect(result.recognized).toBe(false);
  });

  it('canceled + CHARGE_FAILED is ignored (unit)', () => {
    const result = machine.apply('canceled', 'CHARGE_FAILED', ctx);
    expect(result.toStatus).toBe('canceled');
    expect(result.recognized).toBe(false);
  });
});

describe('invalid transitions: end-to-end', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.setup();
  });

  async function createCanceledPro(): Promise<string> {
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    const id = created.body.id;
    await env.api.cancelSubscription(id);
    verify(env).persisted.subscriptionStatus(id, 'canceled');
    return id;
  }

  it('a stray payment.succeeded webhook never reactivates a canceled subscription', async () => {
    const id = await createCanceledPro();

    const res = await env.api.postWebhook(
      env.webhook().withEventId('evt_stray').forSubscription(id).forInvoice('inv_x').ofType('payment.succeeded').build(),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    verify(env).persisted
      .subscriptionStatus(id, 'canceled')
      .paidInvoiceCount(id, 0)
      .noContradictoryRecords(id);
    await verify(env).persisted.apiAndDbAgree(id);
  });

  it('a stray payment.failed webhook does not change a canceled subscription', async () => {
    const id = await createCanceledPro();

    await env.api.postWebhook(
      env.webhook().withEventId('evt_stray_fail').forSubscription(id).forInvoice('inv_y').ofType('payment.failed').build(),
    );

    verify(env).persisted.subscriptionStatus(id, 'canceled').failedChargeCount(id, 0);
  });

  it('cancelling an already-canceled subscription is rejected (409), not a silent re-cancel', async () => {
    const id = await createCanceledPro();
    const res = await env.api.cancelSubscription(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_canceled');
  });
});
