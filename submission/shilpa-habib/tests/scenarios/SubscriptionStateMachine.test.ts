import { describe, expect, it } from "vitest"; import { InvalidSubscriptionTransitionError, SubscriptionStateMachine, } from "../../src/domain/SubscriptionStateMachine"; import type { SubscriptionStatus } from "../../src/domain/Subscription";

describe("SubscriptionStateMachine", () => { const stateMachine = new SubscriptionStateMachine();

it.each([ ["trialing", "payment_succeeded", "active"], ["trialing", "payment_failed", "past_due"], ["active", "payment_failed", "past_due"], ["active", "customer_canceled", "canceled"], ["trialing", "customer_canceled", "canceled"], ["past_due", "payment_succeeded", "active"], ["past_due", "retries_exhausted", "canceled"], ] as const)( "transitions %s on %s to %s", (current, trigger, expected) => { expect( stateMachine.transition( current as SubscriptionStatus, trigger, ), ).toBe(expected); }, );

it.each([ ["canceled", "payment_succeeded"], ["canceled", "payment_failed"], ["active", "retries_exhausted"], ] as const)( "rejects invalid transition from %s on %s", (current, trigger) => { expect(() => stateMachine.transition( current as SubscriptionStatus, trigger, ), ).toThrow(InvalidSubscriptionTransitionError); }, );

it("reports whether a transition is allowed", () => { expect(stateMachine.canTransition("trialing", "payment_succeeded")).toBe(true); expect(stateMachine.canTransition("canceled", "payment_succeeded")).toBe(false); }); });