import { ActiveState } from '../../src/domain/state/active.state';
import { CanceledState } from '../../src/domain/state/canceled.state';
import { PastDueState } from '../../src/domain/state/past-due.state';
import { TrialingState } from '../../src/domain/state/trialing.state';
import { InvalidTransitionError } from '../../src/domain/state/subscription-state.interface';

describe('subscription lifecycle state machine', () => {
  it('allows trialing -> active -> past_due -> active', () => {
    const trialing = new TrialingState();
    expect(trialing.paymentSucceeded().status).toBe('active');
    const active = new ActiveState();
    expect(active.paymentFailed(false).status).toBe('past_due');
    expect(new PastDueState().paymentSucceeded().status).toBe('active');
  });

  it('allows trialing and active subscriptions to cancel', () => {
    expect(new TrialingState().cancel().status).toBe('canceled');
    expect(new ActiveState().cancel().status).toBe('canceled');
    expect(() => new PastDueState().cancel()).toThrow(InvalidTransitionError);
  });

  it('moves trialing payment failures to past_due and exhausted retries to canceled', () => {
    expect(new TrialingState().paymentFailed(false).status).toBe('past_due');
    expect(new PastDueState().paymentFailed(true).status).toBe('canceled');
  });

  it('rejects payment and cancellation transitions from canceled', () => {
    const canceled = new CanceledState();
    expect(() => canceled.paymentSucceeded()).toThrow(InvalidTransitionError);
    expect(() => canceled.paymentFailed(false)).toThrow(InvalidTransitionError);
    expect(() => canceled.cancel()).toThrow(InvalidTransitionError);
  });
});
