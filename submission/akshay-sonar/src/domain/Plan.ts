export type PlanId = "basic" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceInCents: number;
  trialDays: number;
}