import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SubscriptionLifecycle } from '../src/domain.ts';

test('canceled subscriptions cannot activate through a late payment', () => {
  assert.throws(() => new SubscriptionLifecycle().next('canceled', 'paid'), /Invalid transition/);
});
