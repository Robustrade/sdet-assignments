export interface Billing {
  id?: string;
  userId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status?: string;
}
