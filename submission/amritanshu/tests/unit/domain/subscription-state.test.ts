import { describe, expect, it } from "vitest";
import {
  InvalidSubscriptionTransitionError,
  SubscriptionStateMachine,
} from "../../../src/domain/subscription-state.js";

describe("SubscriptionStateMachine", () => {
  describe("valid transitions", () => {
    it.each([
      ["trialing", "payment.succeeded", "active"],
      ["trialing", "payment.failed", "past_due"],
      ["trialing", "cancel", "canceled"],
      ["active", "payment.failed", "past_due"],
      ["active", "cancel", "canceled"],
      ["past_due", "payment.succeeded", "active"],
      ["past_due", "cancel", "canceled"],
    ] as const)(
      "%s + %s should transition to %s",
      (currentState, event, expectedState) => {
        const stateMachine = new SubscriptionStateMachine(currentState);

        expect(stateMachine.transition(event)).toBe(expectedState);
      },
    );
  });

  describe("invalid transitions", () => {
    it.each([
      ["canceled", "payment.succeeded"],
      ["canceled", "payment.failed"],
      ["canceled", "cancel"],
      ["active", "payment.succeeded"],
      ["past_due", "payment.failed"],
    ] as const)(
      "%s + %s should be rejected",
      (currentState, event) => {
        const stateMachine = new SubscriptionStateMachine(currentState);

        expect(() => stateMachine.transition(event)).toThrow(
          InvalidSubscriptionTransitionError,
        );
      },
    );
  });
});