
import { SubscriptionStateMachine } from "../../src/state-machine/SubscriptionStateMachine";
import { SubscriptionStatus } from "../../src/models/Subscription";

describe("SubscriptionStateMachine", () => {
    const stateMachine = new SubscriptionStateMachine();

    it("should allow trialing to active", () => {
        expect(
            stateMachine.transition("trialing", "active")
        ).toBe("active");
    });

    it("should allow active to past_due", () => {
        expect(
            stateMachine.transition("active", "past_due")
        ).toBe("past_due");
    });

    it("should allow past_due to active after successful payment", () => {
        expect(
            stateMachine.transition("past_due", "active")
        ).toBe("active");
    });

    it("should allow cancellation from active", () => {
        expect(
            stateMachine.transition("active", "canceled")
        ).toBe("canceled");
    });

    it("should reject reactivation after cancellation", () => {
        expect(() =>
            stateMachine.transition("canceled", "active")
        ).toThrow("Invalid subscription transition");
    });

    it("should reject invalid transitions", () => {
        expect(() =>
            stateMachine.transition("active", "trialing")
        ).toThrow("Invalid subscription transition");
    });
});
