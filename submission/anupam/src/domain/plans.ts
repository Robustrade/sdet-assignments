import { UnknownPlanError } from './errors';
import type { Currency, PlanId } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY_MS);

/**
 * PATTERN: Strategy.
 *
 * Every plan-specific rule (price, trial length, retry budget, billing period)
 * lives behind this interface, so the billing code never does
 * `if (plan === 'pro') ...`. Adding a plan = adding a class.
 */
export interface PlanPolicy {
  readonly id: PlanId;
  readonly priceCents: number;
  readonly currency: Currency;
  readonly trialDays: number;
  readonly billingPeriodDays: number;
  readonly maxPaymentRetries: number;
  trialEndsAt(start: Date): Date;
  nextPeriodEnd(from: Date): Date;
  /** failedAttempts counts the first failure + every failed retry. */
  isRetryBudgetExhausted(failedAttempts: number): boolean;
}

abstract class BasePlan implements PlanPolicy {
  abstract readonly id: PlanId;
  abstract readonly priceCents: number;
  abstract readonly trialDays: number;
  abstract readonly maxPaymentRetries: number;
  readonly currency: Currency = 'USD';
  readonly billingPeriodDays: number = 30;

  trialEndsAt(start: Date): Date {
    return addDays(start, this.trialDays);
  }
  nextPeriodEnd(from: Date): Date {
    return addDays(from, this.billingPeriodDays);
  }
  isRetryBudgetExhausted(failedAttempts: number): boolean {
    return failedAttempts > this.maxPaymentRetries;
  }
}

/** 14-day trial, $19.00, 2 retries. */
export class BasicPlan extends BasePlan {
  readonly id = 'basic' as const;
  readonly priceCents = 1900;
  readonly trialDays = 14;
  readonly maxPaymentRetries = 2;
}

/** No trial (charged at signup), $49.00, 3 retries. */
export class ProPlan extends BasePlan {
  readonly id = 'pro' as const;
  readonly priceCents = 4900;
  readonly trialDays = 0;
  readonly maxPaymentRetries = 3;
}

/** Registry/lookup for plan strategies. */
export class PlanCatalog {
  private readonly plans = new Map<string, PlanPolicy>();

  constructor(plans: PlanPolicy[] = [new BasicPlan(), new ProPlan()]) {
    plans.forEach((p) => this.plans.set(p.id, p));
  }
  get(id: string): PlanPolicy {
    const plan = this.plans.get(id);
    if (!plan) throw new UnknownPlanError(id);
    return plan;
  }
  all(): PlanPolicy[] {
    return [...this.plans.values()];
  }
}
