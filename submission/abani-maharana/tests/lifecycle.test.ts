import { describe, expect, it } from "vitest";

import { SubscriptionStateMachine } from "../src/domain/subscription";

describe("Subscription lifecycle", () => {
  const machine = new SubscriptionStateMachine();

  it.each([
    ["trialing", "first_charge_succeeded", "active"],
    ["trialing", "first_charge_failed", "past_due"],
    ["trialing", "customer_canceled", "canceled"],
    ["active", "recurring_charge_failed", "past_due"],
    ["active", "customer_canceled", "canceled"],
    ["past_due", "retry_succeeded", "active"],
    ["past_due", "retries_exhausted", "canceled"],
  ] as const)("%s + %s -> %s", (current, event, expected) => {
    expect(machine.transition(current, event)).toBe(expected);
  });

  it("rejects canceled -> active", () => {
    expect(() => machine.transition("canceled", "retry_succeeded")).toThrow();
  });

  it("rejects active -> active through first charge", () => {
    expect(() =>
      machine.transition("active", "first_charge_succeeded"),
    ).toThrow();
  });

  it("rejects past_due -> past_due through first charge failure", () => {
    expect(() =>
      machine.transition("past_due", "first_charge_failed"),
    ).toThrow();
  });
});
