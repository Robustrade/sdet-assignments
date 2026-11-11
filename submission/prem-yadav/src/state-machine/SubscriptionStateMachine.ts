
import { SubscriptionStatus } from "../models/Subscription";

export class SubscriptionStateMachine {
    private readonly transitions: Record<
        SubscriptionStatus,
        SubscriptionStatus[]
    > = {
        trialing: ["active", "past_due", "canceled"],
        active: ["past_due", "canceled"],
        past_due: ["active", "canceled"],
        canceled: [],
    };

    canTransition(
        currentStatus: SubscriptionStatus,
        nextStatus: SubscriptionStatus
    ): boolean {
        return this.transitions[currentStatus].includes(nextStatus);
    }

    transition(
        currentStatus: SubscriptionStatus,
        nextStatus: SubscriptionStatus
    ): SubscriptionStatus {
        if (!this.canTransition(currentStatus, nextStatus)) {
            throw new Error(
                `Invalid subscription transition: ${currentStatus} -> ${nextStatus}`
            );
        }

        return nextStatus;
    }
}
