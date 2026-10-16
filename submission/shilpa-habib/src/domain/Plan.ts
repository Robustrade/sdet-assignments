export type PlanName = "basic" | "pro";

export interface Plan { name: PlanName; priceInCents: number; currency: "USD"; trialDays: number; chargeImmediately: boolean; }

export const PLANS: Record<PlanName, Plan> = { basic: { name: "basic", priceInCents: 1900, currency: "USD", trialDays: 0, chargeImmediately: true, }, pro: { name: "pro", priceInCents: 4900, currency: "USD", trialDays: 14, chargeImmediately: false, }, };

export function getPlan(planName: string): Plan | undefined { if (planName !== "basic" && planName !== "pro") { return undefined; }

return PLANS[planName]; }