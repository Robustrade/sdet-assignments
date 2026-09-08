import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionStateMachine } from '../src/domain/stateMachine';

test('state machine allows every required valid transition', () => {
  const sm = new SubscriptionStateMachine();
  const cases = [
    ['trialing', 'trial_charge_succeeded', 'active'], ['trialing', 'trial_charge_failed', 'past_due'], ['active', 'recurring_charge_failed', 'past_due'],
    ['past_due', 'retry_charge_succeeded', 'active'], ['past_due', 'retries_exhausted', 'canceled'], ['active', 'customer_cancel', 'canceled'], ['trialing', 'customer_cancel', 'canceled']
  ] as const;
  for (const [from, trigger, to] of cases) assert.equal(sm.transition(from, trigger), to);
});

test('state machine rejects canceled reactivation and active retry without failure', () => {
  const sm = new SubscriptionStateMachine();
  assert.throws(() => sm.transition('canceled', 'retry_charge_succeeded'));
  assert.throws(() => sm.transition('active', 'retry_charge_succeeded'));
});
