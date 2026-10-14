import { SubscriptionStateMachine } from "../../src/models/SubscriptionStateMachine";

describe("Subscription State Machine", () => {
  const stateMachine = new SubscriptionStateMachine();

  test.each([
    ["trialing", "active"],
    ["trialing", "past_due"],
    ["trialing", "canceled"],
    ["active", "past_due"],
    ["active", "canceled"],
    ["past_due", "active"],
    ["past_due", "canceled"],
  ] as const)(
    "allows transition from %s to %s",
    (current, next) => {
      expect(stateMachine.canTransition(current, next)).toBe(true);
    }
  );

  test.each([
    ["canceled", "active"],
    ["canceled", "past_due"],
    ["active", "trialing"],
    ["trialing", "trialing"],
  ] as const)(
    "rejects invalid transition from %s to %s",
    (current, next) => {
      expect(stateMachine.canTransition(current, next)).toBe(false);
    }
  );
});
