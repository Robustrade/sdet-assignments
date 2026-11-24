
import { SubscriptionStatus } from "./SubscriptionStateMachine";

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  createdAt: Date;
  updatedAt: Date;
}
