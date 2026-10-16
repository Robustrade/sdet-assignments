import type { PlanName } from "./Plan";

export type SubscriptionStatus = | "trialing" | "active" | "past_due" | "canceled";

export interface Subscription { id: string; customerId: string; plan: PlanName; paymentMethodId: string; status: SubscriptionStatus; createdAt: string; trialEndsAt: string | null; canceledAt: string | null; }