
export type SubscriptionStatus =
    | "trialing"
    | "active"
    | "past_due"
    | "canceled";

export interface Subscription {
    id: string;
    customerId: string;
    plan: "basic" | "pro";
    status: SubscriptionStatus;
    amount: number;
    currency: string;
    paymentMethodId: string;
    trialStartsAt: Date;
    trialEndsAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
