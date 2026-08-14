export type Status = "trialing" | "active" | "past_due" | "canceled";

const allowedTransitions: Record<Status, Status[]> = {
    trialing: ["active", "past_due", "canceled"],
    active: ["past_due", "canceled"],
    past_due: ["active", "canceled"],
    canceled: []
};

export class SubscriptionStateMachine {

    static canTransition(from: Status, to: Status): boolean {
        const allowed = allowedTransitions[from] || [];
        return allowed.includes(to);
    }

    static applyTransition(current: Status, to: Status): Status {
        if (this.canTransition(current as Status, to as Status)) return to as Status;
        throw new Error(`Invalid transition from ${current} to ${to}`);
    }

}
