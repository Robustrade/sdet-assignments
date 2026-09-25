export type PlanId = "basic" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  currency: string;
  trialDays: number;
}