import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionStateMachine } from '../../src/domain/stateMachine';
import type { SubscriptionStatus } from '../../src/domain/types';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

const ctx = { failedChargeCount: 0, maxRetries: 3 };

/**
 * Every valid transition in the lifecycle diagram is exercised here — first as a
 * pure unit test on the state machine (fast, exhaustive), then end-to-end
 * through the service/API/webhooks for the important ones so we know the machine
 * is actually wired in.
 */
describe('state machine: valid transitions (unit)', () => {
  const machine = new SubscriptionStateMachine();

  const cases: Array<[SubscriptionStatus, Parameters<typeof machine.apply>[1], SubscriptionStatus]> =
    [
      ['trialing', 'CHARGE_SUCCEEDED', 'active'],
      ['trialing', 'CHARGE_FAILED', 'past_due'],
      ['trialing', 'CANCEL', 'canceled'],
      ['active', 'CHARGE_FAILED', 'past_due'],
      ['active', 'CANCEL', 'canceled'],
      ['active', 'CHARGE_SUCCEEDED', 'active'], // recurring charge, no regression
      ['past_due', 'CHARGE_SUCCEEDED', 'active'],
      ['past_due', 'CANCEL', 'canceled'],
    ];

  it.each(cases)('%s + %s -> %s', (from, event, expected) => {
    const result = machine.apply(from, event, ctx);
    expect(result.toStatus).toBe(expected);
    expect(result.recognized).toBe(true);
  });

  it('past_due + CHARGE_FAILED stays past_due until retries are exhausted', () => {
    const notYet = machine.apply('past_due', 'CHARGE_FAILED', { failedChargeCount: 1, maxRetries: 3 });
    expect(notYet.toStatus).toBe('past_due');

    const exhausted = machine.apply('past_due', 'CHARGE_FAILED', {
      failedChargeCount: 2,
      maxRetries: 3,
    });
    expect(exhausted.toStatus).toBe('canceled');
    expect(exhausted.reason).toContain('retries exhausted');
  });
});

describe('state machine: valid transitions (end-to-end)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.setup();
  });

  async function createPro(): Promise<string> {
    const res = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    return res.body.id;
  }

  it('trialing -> active when the first charge succeeds (webhook)', async () => {
    const id = await createPro();

    await env.api.postWebhook(
      env.webhook().withEventId('evt_1').forSubscription(id).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );

    await verify(env).persisted.subscriptionStatus(id, 'active').noContradictoryRecords(id);
    await verify(env).persisted.apiAndDbAgree(id);
  });

  it('trialing -> past_due when the first charge fails', async () => {
    const id = await createPro();

    await env.api.postWebhook(
      env.webhook().withEventId('evt_1').forSubscription(id).forInvoice('inv_1').ofType('payment.failed').build(),
    );

    verify(env).persisted.subscriptionStatus(id, 'past_due').failedChargeCount(id, 1);
  });

  it('active -> past_due -> active (recurring failure then successful retry)', async () => {
    const id = await createPro();
    await env.api.postWebhook(
      env.webhook().withEventId('evt_1').forSubscription(id).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );
    verify(env).persisted.subscriptionStatus(id, 'active');

    await env.api.postWebhook(
      env.webhook().withEventId('evt_2').forSubscription(id).forInvoice('inv_2').ofType('payment.failed').build(),
    );
    verify(env).persisted.subscriptionStatus(id, 'past_due').failedChargeCount(id, 1);

    await env.api.postWebhook(
      env.webhook().withEventId('evt_3').forSubscription(id).forInvoice('inv_3').ofType('payment.succeeded').build(),
    );
    verify(env).persisted
      .subscriptionStatus(id, 'active')
      .failedChargeCount(id, 0)
      .noContradictoryRecords(id);
  });

  it('past_due -> canceled when retries are exhausted', async () => {
    const id = await createPro();
    // first charge fails -> past_due (count 1)
    await env.api.postWebhook(
      env.webhook().withEventId('e1').forSubscription(id).forInvoice('i1').ofType('payment.failed').build(),
    );
    // second failure -> still past_due (count 2)
    await env.api.postWebhook(
      env.webhook().withEventId('e2').forSubscription(id).forInvoice('i2').ofType('payment.failed').build(),
    );
    verify(env).persisted.subscriptionStatus(id, 'past_due');
    // third failure -> retries exhausted -> canceled
    await env.api.postWebhook(
      env.webhook().withEventId('e3').forSubscription(id).forInvoice('i3').ofType('payment.failed').build(),
    );

    verify(env).persisted.subscriptionStatus(id, 'canceled');
  });

  it('trialing -> canceled via API cancel', async () => {
    const id = await createPro();
    await env.api.cancelSubscription(id);
    verify(env).persisted.subscriptionStatus(id, 'canceled');
  });
});
