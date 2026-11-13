import { describe, expect, it } from "vitest";
import {
  SubscriptionStateMachine,
  type SubscriptionEvent,
  type SubscriptionStatus
} from "../../src/domain/subscription-state-machine";

describe("Subscription State Machine", () => {
  const validTransitions: Array<{
    from: SubscriptionStatus;
    event: SubscriptionEvent;
    expected: SubscriptionStatus;
  }> = [
    { from: "trialing", event: "payment.succeeded", expected: "active" },
    { from: "trialing", event: "payment.failed", expected: "past_due" },
    { from: "active", event: "payment.failed", expected: "past_due" },
    { from: "past_due", event: "payment.succeeded", expected: "active" },
    { from: "past_due", event: "retries.exhausted", expected: "canceled" },
    { from: "active", event: "customer.cancelled", expected: "canceled" },
    { from: "trialing", event: "customer.cancelled", expected: "canceled" }
  ];

  it.each(validTransitions)(
    "allows $from + $event to become $expected",
    ({ from, event, expected }) => {
      expect(SubscriptionStateMachine.transition(from, event)).toBe(expected);
    }
  );

  const invalidTransitions: Array<{
    from: SubscriptionStatus;
    event: SubscriptionEvent;
  }> = [
    { from: "canceled", event: "payment.succeeded" },
    { from: "active", event: "retries.exhausted" },
    { from: "trialing", event: "retries.exhausted" }
  ];

  it.each(invalidTransitions)(
    "rejects invalid transition: $from + $event",
    ({ from, event }) => {
      expect(() => SubscriptionStateMachine.transition(from, event)).toThrow();
    }
  );
});
