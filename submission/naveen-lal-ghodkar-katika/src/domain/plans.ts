export type PlanId = 'basic' | 'pro';

export interface Plan {
  readonly id: PlanId;
  /** Price in minor units (cents). */
  readonly priceCents: number;
  readonly currency: 'USD';
  readonly trialDays: number;
}

// Plans differ only by data, so a lookup table is enough; no per-plan class hierarchy.
const PLANS: ReadonlyMap<string, Plan> = new Map<string, Plan>([
  ['basic', { id: 'basic', priceCents: 1900, currency: 'USD', trialDays: 0 }],
  ['pro', { id: 'pro', priceCents: 4900, currency: 'USD', trialDays: 14 }],
]);

/** Map lookup (not object indexing) so inputs like "constructor" or "__proto__" are not plans. */
export function findPlan(id: string): Plan | undefined {
  return PLANS.get(id);
}
