import { SubscriptionStatus } from "./SubscriptionStatus";

export interface Subscription {
  id: string;
  customerId: string;
  plan: string;
  status: SubscriptionStatus;
}
