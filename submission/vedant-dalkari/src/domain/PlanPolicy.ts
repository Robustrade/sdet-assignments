/**
 * Plan-specific billing policy strategies and registry.
 * Author: Vedant Dalkari
 */

import { ValidationError } from './errors.js';
import type { PlanCode, SubscriptionStatus } from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PlanConfig {
  readonly plan: PlanCode;
  readonly amountCents: number;
  readonly currency: string;
  readonly trialDays: number;
  readonly billingPeriodDays: number;
  readonly maxRetries: number;
  readonly retryIntervalDays: number;
}

export interface PeriodWindow {
  readonly trialEndsAt: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface PlanPolicy {
  readonly config: PlanConfig;
  initialStatus(): SubscriptionStatus;
  computeInitialPeriod(nowIso: string): PeriodWindow;
  computeNextPeriod(fromIso: string): { readonly periodStart: string; readonly periodEnd: string };
  isRetryExhausted(nextFailedAttempts: number): boolean;
}

abstract class BasePlanPolicy implements PlanPolicy {
  public abstract readonly config: PlanConfig;

  public initialStatus(): SubscriptionStatus {
    return this.config.trialDays > 0 ? 'trialing' : 'active';
  }

  public computeInitialPeriod(nowIso: string): PeriodWindow {
    const startMs = Date.parse(nowIso);
    const trialEndsAt =
      this.config.trialDays > 0
        ? new Date(startMs + this.config.trialDays * MS_PER_DAY).toISOString()
        : null;
    const periodEnd = new Date(startMs + this.config.billingPeriodDays * MS_PER_DAY).toISOString();
    return {
      trialEndsAt,
      periodStart: nowIso,
      periodEnd,
    };
  }

  public computeNextPeriod(fromIso: string): {
    readonly periodStart: string;
    readonly periodEnd: string;
  } {
    const startMs = Date.parse(fromIso);
    return {
      periodStart: fromIso,
      periodEnd: new Date(startMs + this.config.billingPeriodDays * MS_PER_DAY).toISOString(),
    };
  }

  public isRetryExhausted(nextFailedAttempts: number): boolean {
    return nextFailedAttempts > this.config.maxRetries;
  }
}

export class StarterPlanPolicy extends BasePlanPolicy {
  public readonly config: PlanConfig = {
    plan: 'starter',
    amountCents: 1900,
    currency: 'USD',
    trialDays: 0,
    billingPeriodDays: 30,
    maxRetries: 2,
    retryIntervalDays: 1,
  };
}

export class GrowthPlanPolicy extends BasePlanPolicy {
  public readonly config: PlanConfig = {
    plan: 'growth',
    amountCents: 4900,
    currency: 'USD',
    trialDays: 14,
    billingPeriodDays: 30,
    maxRetries: 2,
    retryIntervalDays: 1,
  };
}

export class PlanPolicyRegistry {
  private readonly policies = new Map<string, PlanPolicy>();

  public constructor(policies: readonly PlanPolicy[] = [new StarterPlanPolicy(), new GrowthPlanPolicy()]) {
    for (const policy of policies) {
      this.policies.set(policy.config.plan, policy);
    }
  }

  public resolve(plan: string): PlanPolicy {
    const found = this.policies.get(plan);
    if (!found) {
      throw new ValidationError(`Unsupported plan "${plan}". Expected one of: ${[...this.policies.keys()].join(', ')}`);
    }
    return found;
  }

  public listAll(): readonly PlanPolicy[] {
    return [...this.policies.values()];
  }
}
