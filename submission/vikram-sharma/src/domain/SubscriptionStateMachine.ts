import { SubscriptionStatus } from "./SubscriptionStatus";

export class SubscriptionStateMachine {

    private readonly transitions = new Map<SubscriptionStatus, SubscriptionStatus[]>([
        [
            SubscriptionStatus.TRIALING,
            [
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.PAST_DUE,
                SubscriptionStatus.CANCELED
            ]
        ],
        [
            SubscriptionStatus.ACTIVE,
            [
                SubscriptionStatus.PAST_DUE,
                SubscriptionStatus.CANCELED
            ]
        ],
        [
            SubscriptionStatus.PAST_DUE,
            [
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.CANCELED
            ]
        ],
        [
            SubscriptionStatus.CANCELED,
            []
        ]
    ]);

    canTransition(
        current: SubscriptionStatus,
        next: SubscriptionStatus
    ): boolean {

        return this.transitions
            .get(current)
            ?.includes(next) ?? false;

    }

}