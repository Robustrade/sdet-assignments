export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  status: "SUCCESS" | "FAILED";
}