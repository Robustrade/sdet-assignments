import { PlanId } from "./Plan";
import { SubscriptionStatus } from "./SubscriptionStatus";

export interface Subscription {
  id: string;
  customerId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  trialEndsAt: Date;
  currentPeriodEndsAt: Date;
  createdAt: Date;
  canceledAt?: Date;
  retryCount: number;
  maxRetries: number;
}