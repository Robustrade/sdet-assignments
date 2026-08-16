export interface Subscription {
  id?: string;
  userId: string;
  plan: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}
