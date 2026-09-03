import { describe, expect, it } from "vitest";
import { SubscriptionStateMachine } from "../src/domain/SubscriptionStateMachine";
import { SubscriptionStatus } from "../src/domain/SubscriptionStatus";

describe("Subscription State Machine", () => {
  const stateMachine = new SubscriptionStateMachine();

  it("should allow trialing to active", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.TRIALING,
        SubscriptionStatus.ACTIVE
      )
    ).toBe(true);
  });

  it("should allow active to past_due", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PAST_DUE
      )
    ).toBe(true);
  });

  it("should allow past_due to active", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.PAST_DUE,
        SubscriptionStatus.ACTIVE
      )
    ).toBe(true);
  });

  it("should allow active to canceled", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.CANCELED
      )
    ).toBe(true);
  });

  it("should reject canceled to active", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.CANCELED,
        SubscriptionStatus.ACTIVE
      )
    ).toBe(false);
  });

  it("should reject active to trialing", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.TRIALING
      )
    ).toBe(false);
  });

  it("should reject canceled to past_due", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.CANCELED,
        SubscriptionStatus.PAST_DUE
      )
    ).toBe(false);
  });

  it("should throw an error for an invalid transition", () => {
    expect(() =>
      stateMachine.transition(
        SubscriptionStatus.CANCELED,
        SubscriptionStatus.ACTIVE
      )
    ).toThrow("Invalid subscription transition");
  });
});