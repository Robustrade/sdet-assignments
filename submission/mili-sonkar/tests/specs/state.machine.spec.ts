import { describe, expect, it } from 'vitest';
import {
    InvalidTransitionError,
    SubscriptionStateMachine,
} from '../../src/domain/SubscriptionStateMachine.js';
import { Trigger } from '../../src/domain/SubscriptionState.js';

describe('SubscriptionStateMachine', () => {
    const stateMachine = new SubscriptionStateMachine();

    describe('valid transitions', () => {
        it('moves trialing to active when payment succeeds', () => {
            expect(
                stateMachine.transition('trialing', Trigger.PaymentSucceeded),
            ).toBe('active');
        });

        it('moves trialing to past_due when payment fails', () => {
            expect(
                stateMachine.transition('trialing', Trigger.PaymentFailed),
            ).toBe('past_due');
        });

        it('moves trialing to canceled when cancellation is requested', () => {
            expect(
                stateMachine.transition('trialing', Trigger.CancelRequested),
            ).toBe('canceled');
        });

        it('moves active to past_due when payment fails', () => {
            expect(
                stateMachine.transition('active', Trigger.PaymentFailed),
            ).toBe('past_due');
        });

        it('moves active to canceled when cancellation is requested', () => {
            expect(
                stateMachine.transition('active', Trigger.CancelRequested),
            ).toBe('canceled');
        });

        it('moves past_due to active after a successful retry', () => {
            expect(
                stateMachine.transition('past_due', Trigger.RetrySucceeded),
            ).toBe('active');
        });

        it('moves past_due to canceled when retries are exhausted', () => {
            expect(
                stateMachine.transition('past_due', Trigger.RetriesExhausted),
            ).toBe('canceled');
        });

        it('moves past_due to canceled when cancellation is requested', () => {
            expect(
                stateMachine.transition('past_due', Trigger.CancelRequested),
            ).toBe('canceled');
        });
    });

    describe('invalid transitions', () => {
        it('does not allow a canceled subscription to transition', () => {
            expect(() =>
                stateMachine.transition('canceled', Trigger.PaymentSucceeded),
            ).toThrow(InvalidTransitionError);
        });

        it('does not allow an active subscription to retry successfully', () => {
            expect(() =>
                stateMachine.transition('active', Trigger.RetrySucceeded),
            ).toThrow(InvalidTransitionError);
        });

        it('does not allow a trialing subscription to exhaust retries', () => {
            expect(() =>
                stateMachine.transition('trialing', Trigger.RetriesExhausted),
            ).toThrow(InvalidTransitionError);
        });
    });

    describe('transition error details', () => {
        it('includes the state and trigger in the error', () => {
            expect(() =>
                stateMachine.transition('canceled', Trigger.PaymentFailed),
            ).toThrow(
                'Invalid transition: state "canceled" cannot handle trigger "PaymentFailed"',
            );
        });
    });
});