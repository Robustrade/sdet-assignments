import type { PlanId } from "./plan.js";
import type { SubscriptionState } from "./subscription-state.js";

export interface Subscription {
  id: string;
  customerId: string;
  planId: PlanId;
  paymentMethodId: string;
  state: SubscriptionState;
  createdAt: Date;
  canceledAt?: Date;
}