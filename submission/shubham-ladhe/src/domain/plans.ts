import { PlanCode } from './types';
import { addDays } from './time';

/**
 * Plan rules (Strategy). Everything that differs between plans lives behind this
 * interface, so the service never branches on the plan name.
 */
export interface PlanPolicy {
  readonly code: PlanCode;
  readonly priceCents: number;
  readonly trialDays: number;
  /** Total charge attempts allowed for one invoice, including the first. */
  readonly maxAttempts: number;
  readonly billingPeriodDays: number;
  trialEndsAt(start: string): string;
  /** When to retry after the given number of failed attempts, or null when the budget is spent. */
  nextRetryAt(failedAttempts: number, failedAt: string): string | null;
}

abstract class BasePlan implements PlanPolicy {
  abstract readonly code: PlanCode;
  abstract readonly priceCents: number;
  abstract readonly trialDays: number;
  abstract readonly maxAttempts: number;
  readonly billingPeriodDays = 30;

  trialEndsAt(start: string): string {
    return addDays(start, this.trialDays);
  }

  nextRetryAt(failedAttempts: number, failedAt: string): string | null {
    if (failedAttempts >= this.maxAttempts) return null;
    return addDays(failedAt, this.retryDelayDays(failedAttempts));
  }

  protected abstract retryDelayDays(failedAttempts: number): number;
}

/** $19/month, 14-day trial, 3 attempts, retries every 3 days. */
export class BasicPlan extends BasePlan {
  readonly code = 'basic' as const;
  readonly priceCents = 1900;
  readonly trialDays = 14;
  readonly maxAttempts = 3;

  protected retryDelayDays(): number {
    return 3;
  }
}

/** $49/month, no trial (charged at signup), 4 attempts, back-off of 1, 3, 5 days. */
export class ProPlan extends BasePlan {
  readonly code = 'pro' as const;
  readonly priceCents = 4900;
  readonly trialDays = 0;
  readonly maxAttempts = 4;

  private static readonly BACKOFF_DAYS = [1, 3, 5];

  protected retryDelayDays(failedAttempts: number): number {
    const schedule = ProPlan.BACKOFF_DAYS;
    return schedule[Math.min(failedAttempts - 1, schedule.length - 1)] ?? 5;
  }
}

export class PlanCatalog {
  private readonly plans: ReadonlyMap<string, PlanPolicy>;

  constructor(plans: PlanPolicy[] = [new BasicPlan(), new ProPlan()]) {
    this.plans = new Map(plans.map((p) => [p.code, p]));
  }

  find(code: string): PlanPolicy | undefined {
    return this.plans.get(code);
  }

  get(code: PlanCode): PlanPolicy {
    const plan = this.plans.get(code);
    if (!plan) throw new Error(`Plan ${code} is not configured`);
    return plan;
  }

  codes(): string[] {
    return [...this.plans.keys()];
  }
}
