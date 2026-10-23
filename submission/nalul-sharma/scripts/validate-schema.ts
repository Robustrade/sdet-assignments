import assert from 'node:assert/strict';
import { PLANS, SubscriptionLifecycleStateMachine } from '../src/domain.ts';
for (const config of Object.values(PLANS)) {
  assert(config.price > 0); assert(config.trialDays >= 0);
}
assert.equal(new SubscriptionLifecycleStateMachine().getNextStatus('canceled', 'charge_success'), null);
console.log('Schema/domain validation passed');
