import assert from 'node:assert/strict';
import { PLANS, SubscriptionStateMachine } from '../src/domain.ts';
for (const config of Object.values(PLANS)) {
  assert(config.price > 0); assert(config.trialDays >= 0);
}
assert.equal(new SubscriptionStateMachine().next('canceled', 'charge_success'), null);
console.log('Schema/domain validation passed');
