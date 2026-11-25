import { describe, expect, test } from "vitest";
import { SubscriptionStateMachine } from "../../src/state-machine/SubscriptionStateMachine";
import { SubscriptionStatus } from "../../src/domain/SubscriptionStatus";

describe("Subscription State Machine", () => {

  const stateMachine = new SubscriptionStateMachine();

  test("allows TRIALING to ACTIVE", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.TRIALING,
        SubscriptionStatus.ACTIVE
      )
    ).toBe(true);
  });

  test("allows ACTIVE to PAST_DUE", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PAST_DUE
      )
    ).toBe(true);
  });

  test("prevents CANCELED to ACTIVE", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.CANCELED,
        SubscriptionStatus.ACTIVE
      )
    ).toBe(false);
  });

  test("prevents ACTIVE to TRIALING", () => {
    expect(
      stateMachine.canTransition(
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.TRIALING
      )
    ).toBe(false);
  });

});