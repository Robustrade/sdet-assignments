/**
 * Plan catalog.
 *
 * Plan-specific pricing and trial behavior is encapsulated per plan and looked
 * up through a single registry (a lightweight Strategy / registry pattern)
 * rather than scattered `if (plan === 'pro')` branches across the service.
 * Adding a plan means adding one entry here — no billing-logic edits elsewhere.
 */

export interface Plan {
  id: string;
  /** Price in the smallest currency unit (e.g. cents). */
  price: number;
  currency: string;
  /** Length of the free trial in days; 0 means "charge immediately on creation". */
  trialDays: number;
  /** Derived: does this plan start in `trialing`, or charge on creation? */
  readonly startsWithTrial: boolean;
}

function makePlan(input: Omit<Plan, 'startsWithTrial'>): Plan {
  return { ...input, startsWithTrial: input.trialDays > 0 };
}

export class PlanCatalog {
  private readonly plans = new Map<string, Plan>();

  constructor(plans: Plan[]) {
    for (const plan of plans) {
      this.plans.set(plan.id, plan);
    }
  }

  has(planId: string): boolean {
    return this.plans.has(planId);
  }

  /** Returns the plan or throws; callers that need a soft check use {@link has}. */
  get(planId: string): Plan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Unknown plan: ${planId}`);
    }
    return plan;
  }

  all(): Plan[] {
    return [...this.plans.values()];
  }
}

/** The default catalog used by the service fixture and tests. */
export function defaultPlanCatalog(): PlanCatalog {
  return new PlanCatalog([
    // `basic` charges immediately on creation (no trial).
    makePlan({ id: 'basic', price: 1900, currency: 'USD', trialDays: 0 }),
    // `pro` starts in a 14-day trial; first charge arrives as a webhook later.
    makePlan({ id: 'pro', price: 4900, currency: 'USD', trialDays: 14 }),
  ]);
}
