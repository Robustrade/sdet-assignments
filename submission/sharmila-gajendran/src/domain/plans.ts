const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Strategy: each plan owns its price and trial rules, so the rest of the code
 * never branches on the plan name.
 */
export interface PlanPolicy {
  readonly code: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly trialDays: number;
  readonly billingPeriodDays: number;
  /** When the trial ends for a subscription created at `start`. A 0-day trial ends immediately. */
  trialEndsAt(start: Date): Date;
  /** End of a billing period that starts at `periodStart`. */
  periodEndFrom(periodStart: Date): Date;
  /** Plans without a trial are charged in the create request itself. */
  chargesOnCreate(): boolean;
}

abstract class MonthlyUsdPlan implements PlanPolicy {
  abstract readonly code: string;
  abstract readonly priceCents: number;
  abstract readonly trialDays: number;
  readonly currency = 'USD';
  readonly billingPeriodDays = 30;

  trialEndsAt(start: Date): Date {
    return addDays(start, this.trialDays);
  }

  periodEndFrom(periodStart: Date): Date {
    return addDays(periodStart, this.billingPeriodDays);
  }

  chargesOnCreate(): boolean {
    return this.trialDays === 0;
  }
}

export class BasicPlan extends MonthlyUsdPlan {
  override readonly code = 'basic';
  override readonly priceCents = 1900;
  override readonly trialDays = 0;
}

export class ProPlan extends MonthlyUsdPlan {
  override readonly code = 'pro';
  override readonly priceCents = 4900;
  override readonly trialDays = 14;
}

export class PlanCatalog {
  private readonly plans: ReadonlyMap<string, PlanPolicy>;

  constructor(plans: readonly PlanPolicy[] = [new BasicPlan(), new ProPlan()]) {
    this.plans = new Map(plans.map((plan) => [plan.code, plan]));
  }

  find(code: string): PlanPolicy | undefined {
    return this.plans.get(code);
  }

  /** For plans already stored on a subscription; a missing one is a configuration bug. */
  get(code: string): PlanPolicy {
    const plan = this.find(code);
    if (!plan) {
      throw new Error(`Plan '${code}' is not configured`);
    }
    return plan;
  }
}
