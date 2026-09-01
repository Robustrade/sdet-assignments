/**
 * Plan Registry: Encapsulates plan data and pricing
 */

import { Plan } from '../types';

export class PlanRegistry {
  private static plans: Map<string, Plan> = new Map([
    [
      'basic',
      {
        id: 'basic',
        name: 'Basic Plan',
        price: 999, // $9.99
        currency: 'USD',
        trialLengthDays: 14,
        billingCycleDays: 30,
      },
    ],
    [
      'pro',
      {
        id: 'pro',
        name: 'Pro Plan',
        price: 2999, // $29.99
        currency: 'USD',
        trialLengthDays: 7,
        billingCycleDays: 30,
      },
    ],
  ]);

  static getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  static getAllPlans(): Plan[] {
    return Array.from(this.plans.values());
  }

  static isValidPlan(planId: string): boolean {
    return this.plans.has(planId);
  }

  static addPlan(plan: Plan): void {
    this.plans.set(plan.id, plan);
  }
}

/**
 * Utility: Calculate dates based on plan config
 */
export class BillingCalculator {
  static calculateTrialEnd(plan: Plan, startDate: Date = new Date()): Date {
    const trialEnd = new Date(startDate);
    trialEnd.setDate(trialEnd.getDate() + plan.trialLengthDays);
    return trialEnd;
  }

  static calculateNextBillingDate(plan: Plan, startDate: Date = new Date()): Date {
    const nextBilling = new Date(startDate);
    nextBilling.setDate(nextBilling.getDate() + plan.billingCycleDays);
    return nextBilling;
  }

  static isTrialActive(trialEnd: Date, now: Date = new Date()): boolean {
    return now < trialEnd;
  }
}
