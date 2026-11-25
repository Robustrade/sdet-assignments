import { SubscriptionStatus } from "./SubscriptionStateMachine";

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  failedPaymentAttempts?: number;
  trialEndsAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}