import { describe, it, expect } from "vitest";
import {
  SubscriptionStateMachine,
  ALL_EVENTS,
  type SubscriptionState,
  type SubscriptionEvent,
} from "../../src/domain/SubscriptionStateMachine.js";

describe("SubscriptionStateMachine", () => {
  const machine = new SubscriptionStateMachine();

  describe("valid transitions (every arrow in the lifecycle diagram)", () => {
    const valid: Array<[SubscriptionState, SubscriptionEvent, SubscriptionState]> = [
      ["trialing", "charge_succeeded", "active"],
      ["trialing", "charge_failed", "past_due"],
      ["active", "charge_failed", "past_due"],
      ["past_due", "charge_succeeded", "active"],
      ["past_due", "retries_exhausted", "canceled"],
      ["active", "cancel", "canceled"],
      ["trialing", "cancel", "canceled"],
    ];

    it.each(valid)("%s --%s--> %s", (from, event, to) => {
      expect(machine.transition(from, event)).toEqual({ ok: true, state: to });
    });
  });

  describe("invalid transitions are rejected, never silently accepted", () => {
    const invalid: Array<[SubscriptionState, SubscriptionEvent]> = [
      ["canceled", "charge_succeeded"], // stray webhook must not reactivate
      ["canceled", "charge_failed"],
      ["canceled", "cancel"], // cancel twice
      ["past_due", "cancel"], // not in the diagram
      ["active", "retries_exhausted"],
      ["trialing", "retries_exhausted"],
    ];

    it.each(invalid)("%s --%s--> rejected", (from, event) => {
      const result = machine.transition(from, event);
      expect(result.ok).toBe(false);
    });
  });

  it("canceled is terminal for every event", () => {
    for (const event of ALL_EVENTS) {
      expect(machine.transition("canceled", event).ok).toBe(false);
    }
  });
});