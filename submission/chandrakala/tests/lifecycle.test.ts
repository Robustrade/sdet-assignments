import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionLifecycle, type Status, type Trigger } from '../src/domain.ts';

// Independent oracle copied from the assignment, not the implementation table.
const edges: [Status, Trigger, Status][] = [
  ['trialing','paid','active'], ['trialing','failed','past_due'],
  ['active','failed','past_due'], ['past_due','paid','active'],
  ['past_due','exhausted','canceled'], ['active','cancel','canceled'],
  ['trialing','cancel','canceled'],
];
describe('complete lifecycle transition matrix', () => {
  const states: Status[] = ['trialing','active','past_due','canceled'];
  const triggers: Trigger[] = ['paid','failed','cancel','exhausted'];
  for (const state of states) for (const trigger of triggers) {
    const edge = edges.find(([from, action]) => from === state && action === trigger);
    it(`${state} + ${trigger} ${edge ? `-> ${edge[2]}` : 'is rejected'}`, () => {
      const apply = () => new SubscriptionLifecycle().next(state, trigger);
      if (edge) assert.equal(apply(), edge[2]);
      else assert.throws(apply, /Invalid transition/);
    });
  }
});
