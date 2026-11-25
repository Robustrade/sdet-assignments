
import { SubscriptionStateMachine } from "../../src/domain/SubscriptionStateMachine";

describe("Subscription lifecycle state machine", () => {
  let machine: SubscriptionStateMachine;

  beforeEach(() => {
    machine = new SubscriptionStateMachine();
  });

  test("trialing to active is allowed", () => {
    expect(machine.canTransition("trialing", "active")).toBe(true);
  });

  test("active to past_due is allowed", () => {
    expect(machine.canTransition("active", "past_due")).toBe(true);
  });

  test("canceled to active is rejected", () => {
    expect(machine.canTransition("canceled", "active")).toBe(false);
  });

  test("active to trialing is rejected", () => {
    expect(machine.canTransition("active", "trialing")).toBe(false);
  });

  test.each([
    ["trialing", "past_due"],
    ["trialing", "canceled"],
    ["active", "canceled"],
    ["past_due", "active"],
    ["past_due", "canceled"]
  ] as const)(
    "allows transition from %s to %s",
    (current, next) => {
      expect(machine.transition(current, next)).toBe(next);
    }
  );

  test.each([
    ["canceled", "past_due"],
    ["canceled", "trialing"],
    ["past_due", "trialing"]
  ] as const)(
    "rejects invalid transition from %s to %s",
    (current, next) => {
      expect(() => machine.transition(current, next))
        .toThrow("Invalid subscription transition");
    }
  );
});
