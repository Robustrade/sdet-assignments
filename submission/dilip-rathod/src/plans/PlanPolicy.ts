import { addDays } from '../shared/infrastructure';

export interface BillingPeriod {
  start: Date;
  end: Date;
}

/**
 * Strategy for everything that varies by plan. Billing code asks the policy instead of
 * branching on the plan code, so adding a plan is adding a class to the catalog.
 */
export interface PlanPolicy {
  readonly code: string;
  readonly priceCents: number;
  readonly currency: string;
  /** Failed retries tolerated after the first failed charge before the subscription is canceled. */
  readonly maxRetries: number;
  /** When the trial ends, or null when the plan is charged at creation. */
  trialEndsAt(createdAt: Date): Date | null;
  periodStartingAt(start: Date): BillingPeriod;
  nextRetryAt(failedAt: Date): Date;
}

interface MonthlyPlanConfig {
  code: string;
  priceCents: number;
  trialDays: number;
  maxRetries: number;
  retryIntervalDays: number;
}

abstract class MonthlyPlan implements PlanPolicy {
  static readonly PERIOD_DAYS = 30;
  readonly currency = 'USD';
  readonly code: string;
  readonly priceCents: number;
  readonly maxRetries: number;
  private readonly trialDays: number;
  private readonly retryIntervalDays: number;

  protected constructor(config: MonthlyPlanConfig) {
    this.code = config.code;
    this.priceCents = config.priceCents;
    this.maxRetries = config.maxRetries;
    this.trialDays = config.trialDays;
    this.retryIntervalDays = config.retryIntervalDays;
  }

  trialEndsAt(createdAt: Date): Date | null {
    return this.trialDays > 0 ? addDays(createdAt, this.trialDays) : null;
  }

  periodStartingAt(start: Date): BillingPeriod {
    return { start, end: addDays(start, MonthlyPlan.PERIOD_DAYS) };
  }

  nextRetryAt(failedAt: Date): Date {
    return addDays(failedAt, this.retryIntervalDays);
  }
}

export class BasicPlan extends MonthlyPlan {
  constructor() {
    super({ code: 'basic', priceCents: 1900, trialDays: 0, maxRetries: 2, retryIntervalDays: 3 });
  }
}

export class ProPlan extends MonthlyPlan {
  constructor() {
    super({ code: 'pro', priceCents: 4900, trialDays: 14, maxRetries: 3, retryIntervalDays: 3 });
  }
}

export class PlanCatalog {
  private readonly plans: ReadonlyMap<string, PlanPolicy>;

  constructor(plans: PlanPolicy[]) {
    this.plans = new Map(plans.map((p) => [p.code, p]));
  }

  static default(): PlanCatalog {
    return new PlanCatalog([new BasicPlan(), new ProPlan()]);
  }

  find(code: string): PlanPolicy | undefined {
    return this.plans.get(code);
  }

  require(code: string): PlanPolicy {
    const plan = this.plans.get(code);
    if (!plan) throw new Error(`Plan '${code}' is not configured`);
    return plan;
  }

  codes(): string[] {
    return [...this.plans.keys()];
  }
}
