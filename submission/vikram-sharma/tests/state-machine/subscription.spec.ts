import { SubscriptionStateMachine } from "../../src/state-machine/SubscriptionStateMachine";

describe("Subscription state machine", () => {
    test("allows trialing -> active", () => {
        expect(SubscriptionStateMachine.canTransition("trialing", "active")).toBe(true);
    });

    test("forbids canceled -> active", () => {
        expect(SubscriptionStateMachine.canTransition("canceled", "active")).toBe(false);
    });

    test("allows past_due -> canceled", () => {
        expect(SubscriptionStateMachine.canTransition("past_due", "canceled")).toBe(true);
    });
});
