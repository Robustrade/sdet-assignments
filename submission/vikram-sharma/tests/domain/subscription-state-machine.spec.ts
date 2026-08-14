import { SubscriptionStateMachine } from "../../src/domain/SubscriptionStateMachine";
import { SubscriptionStatus } from "../../src/domain/SubscriptionStatus";

describe("Subscription State Machine", () => {

    const stateMachine = new SubscriptionStateMachine();

    it("should allow TRIALING -> ACTIVE", () => {

        expect(
            stateMachine.canTransition(
                SubscriptionStatus.TRIALING,
                SubscriptionStatus.ACTIVE
            )
        ).toBe(true);

    });

    it("should allow TRIALING -> PAST_DUE", () => {

        expect(
            stateMachine.canTransition(
                SubscriptionStatus.TRIALING,
                SubscriptionStatus.PAST_DUE
            )
        ).toBe(true);

    });

    it("should allow ACTIVE -> CANCELED", () => {

        expect(
            stateMachine.canTransition(
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.CANCELED
            )
        ).toBe(true);

    });

});