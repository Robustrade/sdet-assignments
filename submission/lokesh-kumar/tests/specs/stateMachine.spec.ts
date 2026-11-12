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

  // Exhaustive check: every (state, event) pair that is NOT an arrow in the diagram is rejected,
  // so a new, accidental transition added to the table would be caught here.
  describe("exhaustive: only the 7 diagram arrows are accepted", () => {
    const states: SubscriptionState[] = ["trialing", "active", "past_due", "canceled"];
    const arrows = new Set([
      "trialing:charge_succeeded",
      "trialing:charge_failed",
      "active:charge_failed",
      "past_due:charge_succeeded",
      "past_due:retries_exhausted",
      "active:cancel",
      "trialing:cancel",
    ]);

    it("accepts exactly the arrows listed and nothing else", () => {
      const accepted: string[] = [];
      for (const from of states) {
        for (const event of ALL_EVENTS) {
          if (machine.transition(from, event).ok) accepted.push(`${from}:${event}`);
        }
      }
      expect(accepted.sort()).toEqual([...arrows].sort());
    });
  });
});
